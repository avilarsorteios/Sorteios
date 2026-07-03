# Firestore Schema - Lote Premiado

## Collection: `users`

Stores registered user profiles.

| Field      | Type      | Description                          |
|------------|-----------|--------------------------------------|
| uid        | string    | Firebase Auth UID (document ID)      |
| name       | string    | User display name                    |
| email      | string    | User email address                   |
| photoURL   | string    | Profile photo URL (nullable)         |
| role       | string    | User role: "user" or "admin"         |
| createdAt  | timestamp | Account creation timestamp           |

---

## Collection: `lotes`

Stores lottery campaigns.

| Field         | Type      | Description                                          |
|---------------|-----------|------------------------------------------------------|
| id            | string    | Document ID (auto-generated)                         |
| prizeName     | string    | Name/description of the prize                        |
| prizeImage    | string    | URL to the prize image (nullable)                    |
| prizeCost     | number    | Actual cost of the prize in BRL                      |
| totalNumbers  | number    | Total quantity of numbers in this lote               |
| meta          | number    | Goal amount = prizeCost * 2                          |
| numberValue   | number    | Price per number = meta / totalNumbers (2 decimals)  |
| status        | string    | "active", "finished", or "cancelled"                 |
| endDate       | timestamp | Deadline for the lote                                |
| soldCount     | number    | Count of sold numbers                                |
| createdAt     | timestamp | Lote creation timestamp                              |
| winnerId      | string    | UID of the winner (null until draw)                  |
| winnerNumber  | string    | Winning 6-digit number (null until draw)             |
| drawDate      | timestamp | When the draw was performed (null until draw)        |
| prizeDelivered| boolean   | Whether prize has been delivered                     |
| deliveredAt   | timestamp | When delivery was confirmed (nullable)               |

---

## Subcollection: `lotes/{loteId}/numbers`

Stores individual lottery numbers. Document ID = the 6-digit number string.

| Field      | Type      | Description                                      |
|------------|-----------|--------------------------------------------------|
| number     | string    | 6-digit random code (100000-999999)              |
| status     | string    | "available", "reserved", or "sold"               |
| userId     | string    | UID of user who reserved/bought (nullable)       |
| reservedAt | timestamp | When the number was reserved (nullable)          |
| soldAt     | timestamp | When payment was confirmed (nullable)            |

---

## Collection: `purchases`

Stores purchase/payment records.

| Field         | Type      | Description                                      |
|---------------|-----------|--------------------------------------------------|
| id            | string    | Document ID (auto-generated)                     |
| userId        | string    | UID of the purchasing user                       |
| loteId        | string    | Reference to the lote                            |
| numbers       | array     | Array of 6-digit number strings purchased        |
| amount        | number    | Total payment amount in BRL                      |
| paymentId     | string    | Mercado Pago payment ID                          |
| paymentStatus | string    | "pending", "approved", "rejected", "expired"     |
| pixCode       | string    | PIX copia e cola code for payment                |
| createdAt     | timestamp | Purchase creation timestamp                      |

---

## Collection: `notifications`

Stores user notifications.

| Field     | Type      | Description                                          |
|-----------|-----------|------------------------------------------------------|
| id        | string    | Document ID (auto-generated)                         |
| userId    | string    | Target user UID                                      |
| type      | string    | "purchase_confirmed", "winner", "draw_result", "prize_delivered" |
| title     | string    | Notification title                                   |
| message   | string    | Notification body message                            |
| read      | boolean   | Whether the user has read this notification          |
| createdAt | timestamp | Notification creation timestamp                      |

---

## Collection: `config`

Stores application configuration. Single document with ID "general".

| Field                   | Type   | Description                              |
|-------------------------|--------|------------------------------------------|
| adminUids               | array  | Array of UIDs with admin privileges      |
| mercadoPagoPublicKey    | string | Mercado Pago public key (for frontend)   |
| mercadoPagoAccessToken  | string | Mercado Pago access token (for backend)  |

---

## Indexes Required

1. `purchases` - composite index on (`paymentId`, ASC)
2. `purchases` - composite index on (`userId`, `loteId`, `paymentStatus`)
3. `purchases` - composite index on (`paymentStatus`, `createdAt` DESC)
4. `notifications` - composite index on (`userId`, `createdAt` DESC)
5. `lotes/{loteId}/numbers` - composite index on (`status`, `reservedAt`)

---

## Security Notes

- Numbers subcollection uses the number itself as document ID for fast lookups
- The `config` collection should have restricted read/write rules (admin only)
- Reservation timeout is 10 minutes, enforced by scheduled function
- Firestore transactions prevent race conditions on number reservation
