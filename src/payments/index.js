// src/payments/index.js — payment provider registry.
// COD and BANK work today. TELR (UAE cards) and JAZZCASH (PK wallets/cards)
// are documented adapters: fill the env vars and the marked TODOs once your
// merchant accounts are approved. The server never trusts client-side prices.

const COD_FEE = { AE: 10, PK: 200 };           // in local currency
const PKR_PER_AED = 76;                        // keep in sync with pricing policy

const providers = {
  // ---------------------------------------------------------------- COD
  cod: {
    label: 'Cash on Delivery',
    available: country => country === 'AE' || country === 'PK',
    fee: country => COD_FEE[country] ?? 0,
    async initiate(order) {
      // Nothing to charge online; order proceeds, paid on delivery.
      return { kind: 'confirmed', payment_status: 'pending' };
    },
  },

  // ------------------------------------------------------- Bank transfer
  bank: {
    label: 'Bank transfer / JazzCash manual',
    available: () => true,
    fee: () => 0,
    async initiate(order) {
      // Show your account details; mark paid manually in admin after receipt.
      return {
        kind: 'instructions',
        payment_status: 'pending',
        instructions:
          order.country === 'PK'
            ? 'Send the total to JazzCash/Easypaisa 03XX-XXXXXXX or IBAN PKXX XXXX ... then WhatsApp the receipt with your order number.'
            : 'Transfer the total to IBAN AEXX XXXX ... (SAJA FZ) and WhatsApp the receipt with your order number.',
      };
    },
  },

  // --------------------------------------------------------- Telr (UAE)
  // Docs: https://telr.com — hosted payment page flow.
  telr: {
    label: 'Card (Visa / Mastercard) — UAE',
    available: country => country === 'AE' && !!process.env.TELR_STORE_ID,
    fee: () => 0,
    async initiate(order) {
      // TODO when approved:
      // 1) POST https://secure.telr.com/gateway/order.json with
      //    { ivp_store: TELR_STORE_ID, ivp_authkey: TELR_AUTH_KEY,
      //      ivp_amount: order.total, ivp_currency: 'AED',
      //      ivp_cart: order.order_no, return_auth/can/decl: your URLs }
      // 2) Redirect customer to response.order.url
      // 3) Telr calls your webhook -> verify -> db.setPayment(order_no,'paid',ref)
      throw new Error('Card payments not yet configured. Choose COD or bank transfer.');
    },
  },

  // ----------------------------------------------------- JazzCash (PK)
  // Docs: https://sandbox.jazzcash.com.pk — hosted checkout (Page Redirection).
  jazzcash: {
    label: 'JazzCash / Card — Pakistan',
    available: country => country === 'PK' && !!process.env.JAZZCASH_MERCHANT_ID,
    fee: () => 0,
    async initiate(order) {
      // TODO when approved:
      // 1) Build pp_* fields (MerchantID, Password, Amount in paisa, TxnRefNo
      //    = order.order_no, ReturnURL) and compute pp_SecureHash with
      //    HMAC-SHA256 over sorted fields using JAZZCASH_INTEGRITY_SALT.
      // 2) Auto-submit a form to the JazzCash hosted page.
      // 3) Verify the hash on the return/webhook, then setPayment('paid').
      throw new Error('JazzCash not yet configured. Choose COD or bank transfer.');
    },
  },
};

module.exports = { providers, COD_FEE, PKR_PER_AED };
