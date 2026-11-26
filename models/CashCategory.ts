// Cashbook > Categories master (Courier, Transport, Packing, ...). Owner editable.
import { Schema, model, models } from "mongoose";

const CashCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // Which entry direction this category is offered for.
    direction: { type: String, enum: ["IN", "OUT", "BOTH"], default: "BOTH" },
    // System categories (e.g. "Order payment (cash)") are used by later phases
    // and cannot be renamed or deactivated.
    system: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

CashCategorySchema.index({ name: 1 }, { unique: true });

export default models.CashCategory || model("CashCategory", CashCategorySchema);
