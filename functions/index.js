const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

const { createPixPayment, getPaymentStatus } = require("./mercadopago");
const {
  generateUniqueNumbers,
  calculateMeta,
  calculateNumberValue,
  isAdmin,
  generateDrawWinner,
} = require("./utils");

admin.initializeApp();
const db = admin.firestore();

// ============================================================
// createLote - Admin only: create a new lottery
// ============================================================
exports.createLote = functions.https.onCall(async (data, context) => {
  // Auth check
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  // Admin check
  const adminStatus = await isAdmin(context.auth.uid);
  if (!adminStatus) {
    throw new functions.https.HttpsError("permission-denied", "Only admins can create lotes");
  }

  // Input validation
  const { prizeName, prizeImage, prizeCost, totalNumbers, endDate } = data;

  if (!prizeName || typeof prizeName !== "string" || prizeName.trim().length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "prizeName is required");
  }
  if (!prizeCost || typeof prizeCost !== "number" || prizeCost <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "prizeCost must be a positive number");
  }
  if (!totalNumbers || typeof totalNumbers !== "number" || totalNumbers < 1 || totalNumbers > 900000) {
    throw new functions.https.HttpsError("invalid-argument", "totalNumbers must be between 1 and 900000");
  }
  if (!endDate) {
    throw new functions.https.HttpsError("invalid-argument", "endDate is required");
  }

  // Auto-calculate meta and numberValue
  const meta = calculateMeta(prizeCost);
  const numberValue = calculateNumberValue(meta, totalNumbers);

  // Generate unique 6-digit numbers
  const numbers = generateUniqueNumbers(totalNumbers);

  // Create lote document
  const loteRef = db.collection("lotes").doc();
  const loteData = {
    id: loteRef.id,
    prizeName: prizeName.trim(),
    prizeImage: prizeImage || null,
    prizeCost,
    totalNumbers,
    meta,
    numberValue,
    status: "active",
    endDate: admin.firestore.Timestamp.fromDate(new Date(endDate)),
    soldCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    winnerId: null,
    winnerNumber: null,
    drawDate: null,
    prizeDelivered: false,
  };

  // Use batch to write lote + all numbers
  // Firestore batches limited to 500, so we chunk
  const BATCH_SIZE = 450;
  const chunks = [];
  for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
    chunks.push(numbers.slice(i, i + BATCH_SIZE));
  }

  // Write the lote document first
  await loteRef.set(loteData);

  // Write numbers in batches
  for (const chunk of chunks) {
    const batch = db.batch();
    for (const num of chunk) {
      const numRef = loteRef.collection("numbers").doc(num);
      batch.set(numRef, {
        number: num,
        status: "available",
        userId: null,
        reservedAt: null,
        soldAt: null,
      });
    }
    await batch.commit();
  }

  return { success: true, loteId: loteRef.id, meta, numberValue };
});

// ============================================================
// reserveNumbers - Reserve numbers and create PIX payment
// ============================================================
exports.reserveNumbers = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const { loteId, numbers } = data;
  const uid = context.auth.uid;

  if (!loteId || typeof loteId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "loteId is required");
  }
  if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "numbers must be a non-empty array");
  }
  if (numbers.length > 100) {
    throw new functions.https.HttpsError("invalid-argument", "Cannot reserve more than 100 numbers at once");
  }

  const loteRef = db.collection("lotes").doc(loteId);
  const loteDoc = await loteRef.get();

  if (!loteDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Lote not found");
  }

  const loteData = loteDoc.data();
  if (loteData.status !== "active") {
    throw new functions.https.HttpsError("failed-precondition", "Lote is not active");
  }

  // Use a transaction to reserve numbers atomically
  const reservedAt = admin.firestore.Timestamp.now();
  const amount = parseFloat((loteData.numberValue * numbers.length).toFixed(2));

  await db.runTransaction(async (transaction) => {
    // Verify all numbers are available
    for (const num of numbers) {
      const numRef = loteRef.collection("numbers").doc(num);
      const numDoc = await transaction.get(numRef);

      if (!numDoc.exists) {
        throw new functions.https.HttpsError("not-found", `Number ${num} does not exist in this lote`);
      }
      if (numDoc.data().status !== "available") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Number ${num} is not available (status: ${numDoc.data().status})`
        );
      }
    }

    // Reserve all numbers
    for (const num of numbers) {
      const numRef = loteRef.collection("numbers").doc(num);
      transaction.update(numRef, {
        status: "reserved",
        userId: uid,
        reservedAt: reservedAt,
      });
    }
  });

  // Create purchase record
  const purchaseRef = db.collection("purchases").doc();
  const purchaseData = {
    id: purchaseRef.id,
    userId: uid,
    loteId,
    numbers,
    amount,
    paymentId: null,
    paymentStatus: "pending",
    pixCode: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Create PIX payment via Mercado Pago
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    const pixResult = await createPixPayment(
      amount,
      `Lote Premiado - ${loteData.prizeName} (${numbers.length} numeros)`,
      purchaseRef.id,
      { email: userData.email || context.auth.token.email, name: userData.name || "Cliente" }
    );

    purchaseData.paymentId = pixResult.paymentId;
    purchaseData.pixCode = pixResult.pixCopiaECola;
    await purchaseRef.set(purchaseData);

    return {
      success: true,
      purchaseId: purchaseRef.id,
      amount,
      qrCode: pixResult.qrCode,
      pixCopiaECola: pixResult.pixCopiaECola,
      paymentId: pixResult.paymentId,
      expiresAt: new Date(reservedAt.toDate().getTime() + 10 * 60 * 1000).toISOString(),
    };
  } catch (error) {
    // Rollback reservation if payment creation fails
    const batch = db.batch();
    for (const num of numbers) {
      const numRef = loteRef.collection("numbers").doc(num);
      batch.update(numRef, {
        status: "available",
        userId: null,
        reservedAt: null,
      });
    }
    await batch.commit();

    functions.logger.error("Payment creation failed", error);
    throw new functions.https.HttpsError("internal", "Failed to create payment. Numbers released.");
  }
});

// ============================================================
// webhookMercadoPago - Receive payment confirmation from MP
// ============================================================
exports.webhookMercadoPago = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    try {
      const { type, data } = req.body;

      // Only process payment notifications
      if (type !== "payment") {
        res.status(200).send("OK - ignored");
        return;
      }

      const paymentId = data?.id?.toString();
      if (!paymentId) {
        res.status(400).send("Missing payment ID");
        return;
      }

      // Get payment status from Mercado Pago
      const paymentInfo = await getPaymentStatus(paymentId);

      if (paymentInfo.status !== "approved") {
        // Update purchase status but don't confirm
        const purchaseQuery = await db
          .collection("purchases")
          .where("paymentId", "==", paymentId)
          .limit(1)
          .get();

        if (!purchaseQuery.empty) {
          await purchaseQuery.docs[0].ref.update({ paymentStatus: paymentInfo.status });
        }
        res.status(200).send("OK - not approved");
        return;
      }

      // Payment approved - find purchase by externalReference or paymentId
      let purchaseQuery = await db
        .collection("purchases")
        .where("paymentId", "==", paymentId)
        .limit(1)
        .get();

      // Fallback: search by external reference (purchaseId)
      if (purchaseQuery.empty && paymentInfo.externalReference) {
        const purchaseDoc = await db.collection("purchases").doc(paymentInfo.externalReference).get();
        if (purchaseDoc.exists) {
          purchaseQuery = { empty: false, docs: [purchaseDoc] };
        }
      }

      if (purchaseQuery.empty) {
        functions.logger.warn("Purchase not found for payment", paymentId);
        res.status(200).send("OK - purchase not found");
        return;
      }

      const purchaseDoc = purchaseQuery.docs[0];
      const purchaseData = purchaseDoc.data();

      // Avoid double-processing
      if (purchaseData.paymentStatus === "approved") {
        res.status(200).send("OK - already processed");
        return;
      }

      // Use transaction to confirm numbers and update stats
      await db.runTransaction(async (transaction) => {
        const loteRef = db.collection("lotes").doc(purchaseData.loteId);
        const loteDoc = await transaction.get(loteRef);

        if (!loteDoc.exists) {
          throw new Error("Lote not found");
        }

        // Mark numbers as sold
        for (const num of purchaseData.numbers) {
          const numRef = loteRef.collection("numbers").doc(num);
          transaction.update(numRef, {
            status: "sold",
            soldAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        // Update lote sold count
        transaction.update(loteRef, {
          soldCount: admin.firestore.FieldValue.increment(purchaseData.numbers.length),
        });

        // Update purchase status
        transaction.update(purchaseDoc.ref, { paymentStatus: "approved" });
      });

      // Create notification for user
      await db.collection("notifications").add({
        userId: purchaseData.userId,
        type: "purchase_confirmed",
        title: "Compra confirmada!",
        message: `Seus ${purchaseData.numbers.length} numero(s) foram confirmados. Boa sorte!`,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.status(200).send("OK - payment confirmed");
    } catch (error) {
      functions.logger.error("Webhook error", error);
      res.status(500).send("Internal error");
    }
  });
});

// ============================================================
// checkPaymentStatus - Poll payment status for frontend
// ============================================================
exports.checkPaymentStatus = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const { purchaseId } = data;
  if (!purchaseId || typeof purchaseId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "purchaseId is required");
  }

  const purchaseDoc = await db.collection("purchases").doc(purchaseId).get();
  if (!purchaseDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Purchase not found");
  }

  const purchaseData = purchaseDoc.data();

  // Verify the caller owns this purchase
  if (purchaseData.userId !== context.auth.uid) {
    const adminStatus = await isAdmin(context.auth.uid);
    if (!adminStatus) {
      throw new functions.https.HttpsError("permission-denied", "Not authorized to view this purchase");
    }
  }

  // If already approved in our DB, return immediately
  if (purchaseData.paymentStatus === "approved") {
    return { status: "approved", numbers: purchaseData.numbers };
  }

  // If we have a paymentId, check with Mercado Pago
  if (purchaseData.paymentId) {
    try {
      const paymentInfo = await getPaymentStatus(purchaseData.paymentId);

      if (paymentInfo.status === "approved" && purchaseData.paymentStatus !== "approved") {
        // Payment was approved but webhook hasn't processed yet - process inline
        await db.runTransaction(async (transaction) => {
          const loteRef = db.collection("lotes").doc(purchaseData.loteId);
          const loteDoc = await transaction.get(loteRef);

          if (!loteDoc.exists) throw new Error("Lote not found");

          for (const num of purchaseData.numbers) {
            const numRef = loteRef.collection("numbers").doc(num);
            transaction.update(numRef, {
              status: "sold",
              soldAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }

          transaction.update(loteRef, {
            soldCount: admin.firestore.FieldValue.increment(purchaseData.numbers.length),
          });

          transaction.update(purchaseDoc.ref, { paymentStatus: "approved" });
        });

        return { status: "approved", numbers: purchaseData.numbers };
      }

      // Update local status if changed
      if (paymentInfo.status !== purchaseData.paymentStatus) {
        await purchaseDoc.ref.update({ paymentStatus: paymentInfo.status });
      }

      return { status: paymentInfo.status, numbers: purchaseData.numbers };
    } catch (error) {
      functions.logger.error("Error checking payment status", error);
      return { status: purchaseData.paymentStatus, numbers: purchaseData.numbers };
    }
  }

  return { status: purchaseData.paymentStatus, numbers: purchaseData.numbers };
});

// ============================================================
// releaseExpiredReservations - Scheduled: release numbers reserved > 10 min
// ============================================================
exports.releaseExpiredReservations = functions.pubsub
  .schedule("every 2 minutes")
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const tenMinutesAgo = admin.firestore.Timestamp.fromMillis(
      now.toMillis() - 10 * 60 * 1000
    );

    // Get all active lotes
    const activeLotes = await db
      .collection("lotes")
      .where("status", "==", "active")
      .get();

    let totalReleased = 0;

    for (const loteDoc of activeLotes.docs) {
      // Find reserved numbers older than 10 minutes
      const expiredNumbers = await loteDoc.ref
        .collection("numbers")
        .where("status", "==", "reserved")
        .where("reservedAt", "<=", tenMinutesAgo)
        .get();

      if (expiredNumbers.empty) continue;

      // Release in batches
      const BATCH_SIZE = 450;
      const docs = expiredNumbers.docs;

      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = docs.slice(i, i + BATCH_SIZE);

        for (const numDoc of chunk) {
          batch.update(numDoc.ref, {
            status: "available",
            userId: null,
            reservedAt: null,
          });
        }

        await batch.commit();
        totalReleased += chunk.length;
      }

      // Also mark related purchases as expired
      const expiredUserIds = [...new Set(docs.map((d) => d.data().userId).filter(Boolean))];
      for (const userId of expiredUserIds) {
        const purchases = await db
          .collection("purchases")
          .where("userId", "==", userId)
          .where("loteId", "==", loteDoc.id)
          .where("paymentStatus", "==", "pending")
          .get();

        for (const purchase of purchases.docs) {
          await purchase.ref.update({ paymentStatus: "expired" });
        }
      }
    }

    functions.logger.info(`Released ${totalReleased} expired reservations`);
    return null;
  });

// ============================================================
// performDraw - Admin only: draw winner when 100% sold
// ============================================================
exports.performDraw = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const adminStatus = await isAdmin(context.auth.uid);
  if (!adminStatus) {
    throw new functions.https.HttpsError("permission-denied", "Only admins can perform draws");
  }

  const { loteId } = data;
  if (!loteId || typeof loteId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "loteId is required");
  }

  const loteRef = db.collection("lotes").doc(loteId);
  const loteDoc = await loteRef.get();

  if (!loteDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Lote not found");
  }

  const loteData = loteDoc.data();

  if (loteData.status !== "active") {
    throw new functions.https.HttpsError("failed-precondition", "Lote is not active");
  }

  // Verify 100% sold
  if (loteData.soldCount < loteData.totalNumbers) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Cannot draw: only ${loteData.soldCount}/${loteData.totalNumbers} numbers sold`
    );
  }

  // Get all sold numbers
  const soldNumbersSnapshot = await loteRef
    .collection("numbers")
    .where("status", "==", "sold")
    .get();

  const soldNumbers = soldNumbersSnapshot.docs.map((doc) => ({
    number: doc.data().number,
    userId: doc.data().userId,
  }));

  if (soldNumbers.length === 0) {
    throw new functions.https.HttpsError("failed-precondition", "No sold numbers found");
  }

  // Generate winner
  const winner = generateDrawWinner(soldNumbers);

  // Update lote with winner info
  await loteRef.update({
    status: "finished",
    winnerId: winner.userId,
    winnerNumber: winner.number,
    drawDate: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Notify the winner
  await db.collection("notifications").add({
    userId: winner.userId,
    type: "winner",
    title: "Parabens! Voce ganhou!",
    message: `Seu numero ${winner.number} foi sorteado no lote "${loteData.prizeName}". Entre em contato para retirar seu premio!`,
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Notify all participants about the result
  const participantIds = [...new Set(soldNumbers.map((n) => n.userId))];
  const notifBatch = db.batch();
  for (const participantId of participantIds) {
    if (participantId === winner.userId) continue;
    const notifRef = db.collection("notifications").doc();
    notifBatch.set(notifRef, {
      userId: participantId,
      type: "draw_result",
      title: "Resultado do sorteio",
      message: `O sorteio do lote "${loteData.prizeName}" foi realizado. O numero vencedor foi ${winner.number}.`,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await notifBatch.commit();

  return {
    success: true,
    winnerId: winner.userId,
    winnerNumber: winner.number,
  };
});

// ============================================================
// getAdminDashboard - Aggregated stats for admin panel
// ============================================================
exports.getAdminDashboard = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const adminStatus = await isAdmin(context.auth.uid);
  if (!adminStatus) {
    throw new functions.https.HttpsError("permission-denied", "Only admins can access dashboard");
  }

  // Get all lotes
  const lotesSnapshot = await db.collection("lotes").get();
  const lotes = lotesSnapshot.docs.map((doc) => doc.data());

  const activeLotes = lotes.filter((l) => l.status === "active");
  const finishedLotes = lotes.filter((l) => l.status === "finished");

  // Aggregate stats
  const totalRevenue = lotes.reduce((sum, l) => sum + (l.soldCount || 0) * (l.numberValue || 0), 0);
  const totalNumbersSold = lotes.reduce((sum, l) => sum + (l.soldCount || 0), 0);
  const totalNumbersAvailable = activeLotes.reduce(
    (sum, l) => sum + ((l.totalNumbers || 0) - (l.soldCount || 0)),
    0
  );

  // Get total users
  const usersCount = (await db.collection("users").count().get()).data().count;

  // Get recent purchases (last 20)
  const recentPurchases = await db
    .collection("purchases")
    .where("paymentStatus", "==", "approved")
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  return {
    totalLotes: lotes.length,
    activeLotes: activeLotes.length,
    finishedLotes: finishedLotes.length,
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
    totalNumbersSold,
    totalNumbersAvailable,
    totalUsers: usersCount,
    recentPurchases: recentPurchases.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
    })),
    lotesSummary: lotes.map((l) => ({
      id: l.id,
      prizeName: l.prizeName,
      status: l.status,
      soldCount: l.soldCount,
      totalNumbers: l.totalNumbers,
      meta: l.meta,
      progress: l.totalNumbers > 0 ? parseFloat(((l.soldCount / l.totalNumbers) * 100).toFixed(1)) : 0,
    })),
  };
});

// ============================================================
// confirmDelivery - Admin only: mark prize as delivered
// ============================================================
exports.confirmDelivery = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }

  const adminStatus = await isAdmin(context.auth.uid);
  if (!adminStatus) {
    throw new functions.https.HttpsError("permission-denied", "Only admins can confirm delivery");
  }

  const { loteId } = data;
  if (!loteId || typeof loteId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "loteId is required");
  }

  const loteRef = db.collection("lotes").doc(loteId);
  const loteDoc = await loteRef.get();

  if (!loteDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Lote not found");
  }

  const loteData = loteDoc.data();

  if (loteData.status !== "finished") {
    throw new functions.https.HttpsError("failed-precondition", "Lote draw has not been performed yet");
  }

  if (loteData.prizeDelivered) {
    throw new functions.https.HttpsError("failed-precondition", "Prize already marked as delivered");
  }

  if (!loteData.winnerId) {
    throw new functions.https.HttpsError("failed-precondition", "No winner found for this lote");
  }

  // Mark as delivered
  await loteRef.update({
    prizeDelivered: true,
    deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Notify winner about delivery confirmation
  await db.collection("notifications").add({
    userId: loteData.winnerId,
    type: "prize_delivered",
    title: "Premio entregue!",
    message: `A entrega do premio "${loteData.prizeName}" foi confirmada. Obrigado por participar!`,
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, loteId, winnerId: loteData.winnerId };
});
