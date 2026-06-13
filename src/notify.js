// src/notify.js — order notification hooks.
// Logs all events; extend with email/WhatsApp API when ready.
//
// Events: order_created, status_changed, payment_changed
// Each handler receives (order, extra) where extra has event-specific data.

function notify(event, order, extra = {}) {
  const ts = new Date().toISOString();
  const tag = `[${ts}] ${event} ${order.order_no}`;

  switch (event) {
    case 'order_created':
      console.log(`${tag} — ${order.customer_name}, ${order.currency} ${order.total}, ${order.payment_method}`);
      // TODO: send WhatsApp via API (e.g. WhatsApp Business Cloud API)
      // TODO: send confirmation email to order.email if provided
      break;
    case 'status_changed':
      console.log(`${tag} → ${extra.new_status}`);
      // TODO: notify customer of status update (shipped is the key one)
      break;
    case 'payment_changed':
      console.log(`${tag} payment → ${extra.new_payment_status}`);
      break;
    default:
      console.log(`${tag} (unhandled event)`);
  }
}

module.exports = { notify };
