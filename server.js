// server.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const Stripe = require("stripe");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 4242;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Middlewares
app.use(cors());
app.use(bodyParser.json());

// Connect MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Order Schema
const orderSchema = new mongoose.Schema({
  items: Array,
  customer: Object,
  amount: Number,
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model("Order", orderSchema);

// Checkout Session
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { items, customer } = req.body;

    // Total amount
    const amount = items.reduce((sum, item) => sum + item.price * item.qty, 0);

    // Save pending order
    const order = new Order({ items, customer, amount, status: "pending" });
    await order.save();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: items.map(item => ({
        price_data: {
          currency: "usd",
          product_data: { name: item.name },
          unit_amount: item.price * 100
        },
        quantity: item.qty
      })),
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/success.html`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel.html`,
      metadata: { orderId: order._id.toString() }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Error creating checkout session:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Stripe Webhook
app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata.orderId;
    await Order.findByIdAndUpdate(orderId, { status: "paid" });
    console.log(`✅ Order ${orderId} marked as paid`);
  }

  res.json({ received: true });
});

// Get all orders
app.get("/orders", async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json(orders);
});

// Update order status
app.patch("/orders/:id", async (req, res) => {
  const { status } = req.body;
  await Order.findByIdAndUpdate(req.params.id, { status });
  res.json({ success: true });
});

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
