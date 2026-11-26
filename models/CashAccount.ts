// Cashbook > Accounts master: one CASH account ("Cash in hand") and any number
// of BANK accounts. UPI is a payment mode, not an account - a UPI entry picks
// the BANK account the money moved through. Money is stored as integer paise.
import { Schema, model, models } from "mongoose";

const CashAccountSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["CASH", "BANK"], required: true },
    firmCode: { type: String, trim: true, uppercase: true, default: "" },
    openingPaise: { type: Number, default: 0 },
    // Business date (IST, YYYY-MM-DD) from which openingPaise counts.
    openingDate: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

CashAccountSchema.index({ type: 1, active: 1 });

export default models.CashAccount || model("CashAccount", CashAccountSchema);
