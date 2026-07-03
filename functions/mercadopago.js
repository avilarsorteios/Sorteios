const { MercadoPagoConfig, Payment } = require("mercadopago");
const functions = require("firebase-functions");

let client = null;
let paymentClient = null;

/**
 * Initializes the Mercado Pago client with the access token from environment config.
 */
function initClient() {
  if (!client) {
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN ||
      functions.config().mercadopago?.access_token ||
      "APP_USR-6881189590797748-070120-e87aac5da43e0772b985ce3c7a2441d0-713345368";

    if (!accessToken) {
      throw new Error("Mercado Pago access token not configured");
    }

    client = new MercadoPagoConfig({ accessToken });
    paymentClient = new Payment(client);
  }
  return { client, paymentClient };
}

/**
 * Creates a PIX payment via Mercado Pago.
 * @param {number} amount - Payment amount in BRL.
 * @param {string} description - Payment description.
 * @param {string} externalRef - External reference ID (e.g., purchase ID).
 * @param {object} payer - Payer info with email.
 * @returns {Promise<{qrCode: string, pixCopiaECola: string, paymentId: string}>}
 */
async function createPixPayment(amount, description, externalRef, payer) {
  const { paymentClient: payment } = initClient();

  const paymentData = {
    transaction_amount: amount,
    description: description,
    payment_method_id: "pix",
    payer: {
      email: payer.email || "customer@email.com",
      first_name: payer.name || "Customer",
    },
    external_reference: externalRef,
    notification_url: process.env.WEBHOOK_URL || "https://us-central1-sorteio-705ff.cloudfunctions.net/webhookMercadoPago",
  };

  const response = await payment.create({ body: paymentData });

  const qrCode = response.point_of_interaction?.transaction_data?.qr_code_base64 || "";
  const pixCopiaECola = response.point_of_interaction?.transaction_data?.qr_code || "";
  const paymentId = response.id?.toString() || "";

  return {
    qrCode,
    pixCopiaECola,
    paymentId,
    status: response.status,
  };
}

/**
 * Checks the status of an existing payment.
 * @param {string} paymentId - The Mercado Pago payment ID.
 * @returns {Promise<{status: string, statusDetail: string}>}
 */
async function getPaymentStatus(paymentId) {
  const { paymentClient: payment } = initClient();

  const response = await payment.get({ id: paymentId });

  return {
    status: response.status,
    statusDetail: response.status_detail,
    externalReference: response.external_reference,
  };
}

module.exports = {
  createPixPayment,
  getPaymentStatus,
};
