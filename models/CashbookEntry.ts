// Cashbook entries. Money is integer paise (never float maths on totals).
// Only status APPROVED entries count in any balance / total.
import { Schema, model, models } from "mongoose";

export const ENTRY_TYPES = ["NORMAL", "ADVANCE_TOPUP", "ADVANCE_RETURN", "ORDER_PAYMENT_CASH"] as const;
export const ENTRY_STATUSES = ["PENDING", "APPROVED", "REJECTED", "DELETED"] as const;

const AuditSchema = new Schema(
  {
    action: { type: String, required: true }, // CREATED | APPROVED | REJECTED | EDITED | RESUBMITTED | DELETED
    by: { type: String, required: true },
    at: { type: Date, default: Date.now },
    note: { type: String, default: "" },
  },
  { _id: false }
);

const CashbookEntrySchema = new Schema(
  {
    // Business date (IST, YYYY-MM-DD). createdAt carries the time.
    date: { type: String, required: true },
    direction: { type: String, enum: ["IN", "OUT"], required: true },
    type: { type: String, enum: ENTRY_TYPES, default: "NORMAL" },
    amountPaise: { type: Number, required: true, min: 1 },
    mode: { type: String, enum: ["CASH", "BANK", "UPI"], required: true },
    // Account the money moved through. Null when a staff member spends from
    // their own advance (paidFrom = STAFF_ADVANCE).
    account: { type: Schema.Types.ObjectId, ref: "CashAccount", default: null },
    paidFrom: { type: String, enum: ["ACCOUNT", "STAFF_ADVANCE"], default: "ACCOUNT" },
    staff: { type: String, default: "" }, // wallet owner (username) for advance entries
    categoryId: { type: Schema.Types.ObjectId, ref: "CashCategory" },
    categoryName: { type: String, default: "" },
    particulars: { type: String, required: true, trim: true },
    remark: { type: String, default: "", trim: true },
    attachmentKey: { type: String, default: "" }, // R2 key (cashbook-bills/...)

    // ORDER_PAYMENT_CASH only: cash received from an institute.
    institute: { type: String, default: "" },
    // Cash part tied to specific orders; deductionPaise is the part of the
    // deduction applied to that order (so a reversal restores it exactly).
    allocations: {
      type: [
        new Schema(
          { order: { type: Schema.Types.ObjectId, ref: "SellerOrder" }, orderNo: String, amountPaise: Number, deductionPaise: { type: Number, default: 0 } },
          { _id: false }
        ),
      ],
      default: [],
    },
    onAccountPaise: { type: Number, default: 0 }, // credited to the institute, not tied to an order yet
    deductionPaise: { type: Number, default: 0 },
    deductionType: { type: String, enum: ["TDS", "TDS+GST", "Kasar", null], default: null },
    // Later "Order se jodo": on-account money moved onto orders. No cashbook effect.
    onAccountAllocated: {
      type: [
        new Schema(
          { order: { type: Schema.Types.ObjectId, ref: "SellerOrder" }, orderNo: String, amountPaise: Number, at: { type: Date, default: Date.now }, by: String },
          { _id: false }
        ),
      ],
      default: [],
    },

    status: { type: String, enum: ENTRY_STATUSES, default: "PENDING" },
    rejectReason: { type: String, default: "" },
    enteredBy: { type: String, required: true },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    audit: { type: [AuditSchema], default: [] },
  },
  { timestamps: true }
);

CashbookEntrySchema.index({ date: 1, status: 1 });
CashbookEntrySchema.index({ status: 1, createdAt: 1 });
CashbookEntrySchema.index({ account: 1, status: 1, date: 1 });
CashbookEntrySchema.index({ staff: 1, status: 1, date: 1 });
CashbookEntrySchema.index({ enteredBy: 1, date: -1 });
CashbookEntrySchema.index({ institute: 1, type: 1, status: 1 });
CashbookEntrySchema.index({ "allocations.order": 1 });

export default models.CashbookEntry || model("CashbookEntry", CashbookEntrySchema);
