// Load variables from .env into process.env
require("dotenv").config();

const express = require("express");

const app = express();

// Lets Express read JSON sent in request bodies
app.use(express.json());

// Health check: confirms the server is running
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "ekip-backend" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});