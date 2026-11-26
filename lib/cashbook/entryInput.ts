// Validate + normalise the body of a create/edit NORMAL entry request.
// Two shapes: money moved through an account, or a staff member spending from their own advance.
import CashAccount from "@/models/CashAccount";
import CashCategory from "@/models/CashCategory";
import { CbActor, CbError, isDateStr, toPaise, todayIST } from "./server";

export async function parseEntryInput(b: any, actor: CbActor) {
  if (!["IN", "OUT"].includes(b.direction)) throw new CbError(400, "Cash In ya Cash Out chuno");
  const amountPaise = toPaise(b.amount);

  const date = b.date ? b.date : todayIST();
  if (!isDateStr(date)) throw new CbError(400, "Date sahi nahi hai");
  if (date > todayIST()) throw new CbError(400, "Aage ki date nahi chalegi");

  const fromAdvance = b.paidFrom === "STAFF_ADVANCE";
  let mode: "CASH" | "BANK" | "UPI" = b.mode;
  let account: any = null;
  let staff = "";

  if (fromAdvance) {
    // Staff spends from the advance they hold: only an expense, never touches the main accounts.
    if (b.direction !== "OUT") throw new CbError(400, "Advance se sirf Cash Out (kharcha) ho sakta hai");
    mode = "CASH";
    staff = actor.has("cashbookAdvance") && typeof b.staff === "string" && b.staff.trim() ? b.staff.trim() : actor.username;
  } else {
    if (!["CASH", "BANK", "UPI"].includes(mode)) throw new CbError(400, "Payment mode chuno");
    account = await CashAccount.findById(b.accountId);
    if (!account || !account.active) throw new CbError(400, "Account chuno");
    const wantType = mode === "CASH" ? "CASH" : "BANK";
    if (account.type !== wantType)
      throw new CbError(400, mode === "CASH" ? "Cash ke liye Cash account chuno" : "Bank/UPI ke liye Bank account chuno");
  }

  const cat: any = await CashCategory.findById(b.categoryId);
  if (!cat || !cat.active) throw new CbError(400, "Category chuno");
  if (cat.direction !== "BOTH" && cat.direction !== b.direction) throw new CbError(400, "Yeh category is direction ke liye nahi hai");
  if (cat.system) throw new CbError(400, "Yeh category sirf Cash payment received screen se use hoti hai");

  const particulars = String(b.particulars || "").trim();
  if (!particulars) throw new CbError(400, "Particulars likho");

  return {
    date,
    direction: b.direction as "IN" | "OUT",
    amountPaise,
    mode,
    account: account ? account._id : null,
    paidFrom: (fromAdvance ? "STAFF_ADVANCE" : "ACCOUNT") as "STAFF_ADVANCE" | "ACCOUNT",
    staff,
    categoryId: cat._id,
    categoryName: cat.name,
    particulars,
    remark: String(b.remark || "").trim(),
    attachmentKey: typeof b.attachmentKey === "string" && b.attachmentKey.startsWith("cashbook-bills/") ? b.attachmentKey : "",
  };
}
