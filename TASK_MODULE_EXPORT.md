# TASK_MODULE_EXPORT — DEV OMS "Task Assign & Follow-up" module

> **Kiske liye:** DEV-BID project mein Claude Code / developer ke liye. Is file ke basis par same module AS-IS banana hai.
> **Source:** DEV OMS repo (`dev-oms-main`, branch ka last commit 21-Nov-2026). Har code block asli file se script ke through copy hua hai. Koi summary nahi hai, aur Windows CRLF line endings hata kar LF kiye gaye hain.
> **Secrets:** koi password, API key, DB URL ya secret is file mein nahi hai. Login route ka hardcoded fallback password `<REDACTED>` se replace kiya gaya hai (section 4 dekhein).

---

## ⚠️ Pehle ye padhein: kya bana hai aur kya NAHI bana

Ye module DEV OMS mein **phase-wise** bana hai. Kuch features ke liye DB schema mein fields rakh diye gaye hain, lekin unka **koi logic, API, cron ya UI abhi nahi bana**. DEV-BID mein AS-IS copy karne par yahi state milegi:

| Feature | Status in DEV OMS |
|---|---|
| Task create / assign / reassign | ✅ Bana hai |
| Due date + time (`dueAt`) | ✅ Bana hai. Alag "start time / end time" field nahi hai. `startedAt` (Start dabane par), `completedAt` (Done par) aur `closedAt` (Verify par) apne aap set hote hain |
| Status flow (Open → In Progress → Waiting → Done → Closed / Cancelled) | ✅ Bana hai |
| Verify / Reject / Reopen (manager approval) | ✅ Bana hai |
| Checklist (progress tracking, "x/y done") | ✅ Bana hai. Alag `progress %` field nahi hai; progress = checklist done count |
| Priority, Category, Firm, Watchers, Links (order/bid/bill/buyer) | ✅ Bana hai |
| Comments + @mention (mention sirf store hota hai, notification nahi jaata) | ✅ Bana hai |
| Activity log (har badlav ka history) | ✅ Bana hai |
| Waiting + "next follow-up date" (`nextFollowUpAt`) + "Follow-ups today" stat | ✅ Bana hai |
| Stats row (Open / Due today / Overdue / Waiting / Follow-ups today / To verify) | ✅ Bana hai |
| Navbar TASKS badge (pending count) | ✅ Bana hai |
| Global "New Task" modal (Alt+N har page par) | ✅ Bana hai |
| Bulk reassign / bulk priority (max 50) | ✅ Bana hai |
| Optimistic locking (2 log ek saath edit karein to 409) | ✅ Bana hai |
| Urgent Task (full-screen popup + snooze 10 min + 1 ghante baad escalation flag) | ✅ Code bana hai, **lekin DEV OMS mein DISABLED hai** (popup aur Header button comment-out hain). `/dashboard/urgent-tasks` page abhi bhi chalta hai (sirf `boss`) |
| **Daily / Weekly / Monthly recurring (fixed) tasks** | ❌ **Nahi bana.** Sirf schema field `Task.recurrence` (`DAILY`/`WEEKLY`/`MONTHLY`, `weekdays`, `dayOfMonth`, `nextRunAt`) hai. Koi cron/scheduler nahi hai |
| **Reminders / notifications (WhatsApp / push / email)** | ❌ **Nahi bana.** Sirf fields hain: `Task.lastReminderAt`, `TaskSettings.whatsappEnabled`, `dailyDigestTime`, `eveningSummaryTime` |
| **Auto escalation (manager/admin ko)** | ❌ **Nahi bana.** Sirf fields hain: `Task.escalationLevel`, `TaskSettings.escalateTo*AfterHours` |
| **Follow-up log API (call/WhatsApp/visit entry)** | ❌ **Nahi bana.** Sirf model `TaskFollowUp` hai, koi route/UI nahi |
| Due-date extension request | ❌ Sirf schema (`Task.extensionRequest`) |
| Attachments | ❌ Sirf schema (`Task.attachments`) |
| TaskSettings edit page | ❌ Sirf model hai |

**DEV-BID ke liye matlab:** ❌ wale features chahiye to woh **naya kaam** hoga. Ye file sirf existing module ko 1:1 le jaane ke liye hai. Section 9 mein ❌ features ka short note hai.

---

## 1. Overview

**Module kya karta hai:** team ke andar kaam assign karna, uska status track karna, manager se verify karwana, aur "kis cheez ka wait hai, agla follow-up kab hai" jaisi cheezein rakhna. Har task ka number `TSK-YYMM-0001` format mein banta hai (IST month ke hisaab se).

**Features (jo sach mein bane hain):**

- **Task create:** title, description, assignee, due date-time, priority (LOW/NORMAL/HIGH/URGENT), category (ORDER, DELIVERY, BILLING, PAYMENT_FOLLOWUP, BID, GEM_CATALOGUE, DOCUMENT, PURCHASE, ACCOUNTS, GENERAL), firm (free text), watchers, checklist (max 50 items), `requiresVerification` (default ON).
  - Due-date ke quick chips: Today EOD, Tomorrow, 3 days, Next week.
  - **UI form (CreateTaskModal) mein:** title, description, assignee, due, priority, category, watchers, checklist, requiresVerification. **`firm` aur `links` ka koi UI input nahi hai.** Ye sirf API body se set hote hain, aur drawer mein dikhte hain agar bhare hon.
  - **Drawer mein inline edit:** sirf title, due date, priority aur checklist. Baaki fields (description, category, firm, links, watchers) PATCH API se badle ja sakte hain, par UI mein unka editor nahi hai.
- **Global create:** kisi bhi page par **Alt+N** dabane se ya Tasks page ke "New Task" button se modal khulta hai.
- **Views (tabs):** My Tasks, Watching, Assigned by Me, Team (manager/admin), All (sirf admin).
- **Filters:** status, priority, firm, category, assignee, overdue only, aur search (task no / title / description / assignee / buyer / GeM order no). List 50 per page hoti hai.
- **Default sort:** overdue sabse upar, phir active (due date ke order mein), phir Done (verify), phir closed/cancelled. "Newest" sort bhi hai.
- **Stats row:** Open, Due Today, Overdue, Waiting, Follow-ups Today, To Verify. Card par click karne se list usi filter par aa jaati hai.
- **Status lifecycle:**
  - Start → `IN_PROGRESS`
  - Waiting → `WAITING`. Isme "kiska wait" (BUYER/STAFF/MATERIAL/PAYMENT/OTHER) aur next follow-up date dono zaroori hain. Follow-up chips: Tomorrow, 2 days, Next Mon, 1 week.
  - Done → `DONE`. Agar `requiresVerification = false` hai to seedha `CLOSED` ho jaata hai.
  - Manager Verify → `CLOSED`.
  - Manager Reject (reason zaroori) → `IN_PROGRESS`.
  - Manager Reopen (reason zaroori) → `OPEN`.
  - Cancel (reason zaroori, sirf manager/admin) → `CANCELLED`.
- **Reassign:** purana assignee apne aap watcher ban jaata hai. Bulk reassign aur bulk priority max 50 tasks par.
- **Checklist:** staff sirf tick/untick kar sakta hai. Manager/admin item add, edit aur remove kar sakte hain. Kisne aur kab tick kiya, ye save hota hai.
- **Comments:** `@username` likhne par mention activity mein save hota hai.
- **Activity timeline:** har create, assign, status, due, priority, edit, checklist, comment, verify, reject, reopen, cancel aur delete ki entry banti hai.
- **Soft delete:** sirf admin. Task par `isDeleted: true` lagta hai.
- **Concurrency:** har update `updatedAt` match karke hota hai. Beech mein kisi aur ne update kar diya ho to `409 "Task kisi aur ne update kiya hai, refresh karo"` aata hai.
- **Navbar badge:** user ke apne pending tasks (DONE/CLOSED/CANCELLED ke alawa). Ye har 60s par refresh hota hai (sirf jab tab visible ho), tab par focus aane par, aur `tasks:changed` event par.
- **Tasks page auto-refresh:** har 30s, sirf jab tab visible ho.
- **IST time:** server par saare "aaj" wale calculations Asia/Kolkata (UTC+5:30) mein hote hain, server ka apna timezone kuch bhi ho.
- **Urgent Task** (alag, simple module, DEV OMS mein abhi disabled):
  - Owner ek one-line urgent kaam assign karta hai.
  - Assignee ki screen par full-screen popup aata hai, jo har 25s poll karta hai. Usme sirf "Done" ya "Snooze 10 min" ka option hai.
  - 1 ghante se zyada pending rahe to `escalated` flag lagta hai (read time par calculate hota hai, koi cron nahi).

---

## 2. Tech stack & dependencies

**Framework:** Next.js App Router (frontend aur backend ek hi project mein; API = `app/api/**/route.ts`). Database MongoDB hai. Mongoose aur official `mongodb` driver dono use hote hain. Styling Tailwind CSS v4 se hai. Language TypeScript hai (sirf `models/User.js` JS hai). Node version: `.nvmrc` = **22**.

Path alias: `tsconfig.json` mein `"paths": { "@/*": ["./*"] }` hai, aur saare imports `@/lib/...`, `@/models/...` isi par chalte hain.

### Runtime packages (module ke liye zaroori)

| Package | package.json range | Installed (package-lock) | Kahan use hota hai |
|---|---|---|---|
| `next` | `^16.1.6` | 16.2.10 | Frontend + backend |
| `react` | `19.2.3` | 19.2.3 | Frontend |
| `react-dom` | `19.2.3` | 19.2.3 | Frontend |
| `mongoose` | `^8.24.1` | 8.24.1 | Backend: Task, TaskActivity, Counter, UrgentTask models + `dbConnect` |
| `mongodb` | `^7.1.0` | 7.1.0 | Backend: login + users API (`lib/mongodb.ts`) |
| `react-icons` | `^5.5.0` | 5.5.0 | Frontend icons (`react-icons/fi`) |

### Dev packages

| Package | package.json range | Installed |
|---|---|---|
| `typescript` | `^5` | 5.9.3 |
| `tailwindcss` | `^4` | 4.1.18 |
| `@tailwindcss/postcss` | `^4` | 4.1.18 |
| `@types/node` | `^20` | 20.19.33 |
| `@types/react` | `^19` | 19.2.14 |
| `@types/react-dom` | `^19` | 19.2.3 |

Koi JWT, bcrypt, cron, socket ya notification library **use nahi hoti** (section 4 aur 9 dekhein).

### Install command

```bash
npm install next@16.2.10 react@19.2.3 react-dom@19.2.3 mongoose@8.24.1 mongodb@7.1.0 react-icons@5.5.0
npm install -D typescript@5.9.3 tailwindcss@4.1.18 @tailwindcss/postcss@4.1.18 @types/node@20.19.33 @types/react@19.2.14 @types/react-dom@19.2.3
```

Tailwind v4 setup (DEV OMS jaisa):

```js
// postcss.config.mjs
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

```css
/* app/globals.css (pehli line) */
@import "tailwindcss";
```

---

## 3. Environment variables

Module, login aur notifications ke liye **sirf ek** env variable use hota hai:

| Key | Kis kaam ka |
|---|---|
| `MONGODB_URI` | MongoDB connection string. `lib/dbConnect.ts` (mongoose) aur `lib/mongodb.ts` (driver) dono isi ko padhte hain. Login aur users API DB naam `dev_oms_db` use karte hain (ek jagah explicitly `client.db("dev_oms_db")`, baaki jagah `client.db()` jo URI ka default DB leta hai) |
| `NODE_ENV` | Next.js khud set karta hai. `lib/mongodb.ts` dev mode mein client ko global par cache karta hai |

**Note:** DEV OMS ki `.env.local` mein `SESSION_SECRET` aur `ADMIN_PASSWORD_HASH` ke comments hain ("middleware.ts session cookie", "lib/password.ts scrypt hash"). **Lekin repo mein ye files exist nahi karti aur koi code in variables ko padhta nahi.** Ye shayad aage ka plan tha. DEV-BID mein inhe copy na karein, jab tak aap khud session/hash wala login nahi banate (section 4 ka recommendation dekhein).

Notifications ke liye koi env nahi hai, kyunki notification feature bana hi nahi hai.

---

## 4. Login / Authentication

### Asli flow (jaisa DEV OMS mein hai)

1. `/login` page `POST /api/login` ko `{ username, password }` bhejta hai.
2. Server do jagah check karta hai:
   - **Hardcoded super-admins:** username `admin`, `chintan` ya `hitesh` ho (case-insensitive) aur password ek fixed string se match kare (asli value yahan `<REDACTED>` hai). Tab full permissions (`boss: true` ...) return hoti hain. Ye users DB mein na hon tab bhi chalta hai.
   - Warna `users` collection mein `findOne({ username, password })`. **Password plain text mein save aur compare hota hai. Koi hashing nahi hai.**
3. Response `{ success, username, permissions }` hota hai. Frontend ise **`localStorage["oms_user"]`** mein JSON ki tarah rakh leta hai.
4. **Koi JWT, cookie ya server session nahi hai.** Har task API call par frontend header **`x-oms-user: <username>`** bhejta hai (`taskUi.ts` → `api()`).
   - Server (`getActor`) is username se **har request par DB se permissions dobara padhta hai** aur role nikalta hai.
   - Username header, `?username=` query, ya body ke `username` se liya jaata hai.
5. **Logout:** `localStorage.removeItem("oms_user")` karke `/login` par redirect (Header mein). Koi logout API nahi hai.
6. **Idle auto-logout:** Header 2 ghante tak koi activity (click, key, scroll, touch) na ho to logout kar deta hai.
7. **Current-user API:** alag nahi hai. Frontend `localStorage` se padhta hai. Server-side "current user" = `getActor()` ([lib/tasks/permissions.ts](#libtaskspermissionsts)). `GET /api/users?username=X` ek user ka record deta hai.
8. **Route guarding:** koi Next middleware nahi hai. Root layout (`app/layout.tsx`) client-side check karta hai ki `oms_user` hai ya nahi; nahi hai to `/login`. Page-level guard `BlockGuard` component se hota hai (permission key check, sirf UI).

> 🔴 **Security gap (DEV OMS ke code comments mein bhi "Known gap" likha hai):**
> - Koi bhi `x-oms-user` header mein kisi aur ka username daal kar uski tarah act kar sakta hai.
> - Passwords plain text mein hain.
> - `GET /api/users` saare users ke password bhi return karta hai.
>
> **DEV-BID ke liye recommendation:** agar DEV-BID mein pehle se proper login (JWT/session cookie + bcrypt) hai, to **wahi rakhein** aur sirf `getActor()` ko badlein: username header se lene ki jagah verified session se lein. Baaki module waisa hi chalega (section 11 dekhein). AS-IS copy karna ho to bhi ye gap DEV-BID mein aa jaayega.

### "Auth middleware" = `getActor()` (full code section 5 mein, `lib/tasks/permissions.ts`)

Task APIs ka saara auth isi function se hota hai. Alag `middleware.ts` file nahi hai.

### Login API

### `app/api/login/route.ts`

```ts
// FILE: app/api/login/route.ts
import clientPromise from "@/lib/mongodb";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    const usernameLower = username?.toLowerCase();

    // Check for hardcoded fallback/static admin login
    if (
      (usernameLower === "admin" || usernameLower === "chintan" || usernameLower === "hitesh") &&
      password === "<REDACTED>" /* DEV OMS ka hardcoded fallback password - hata diya. DEV-BID me env se padhein, e.g. process.env.ADMIN_FALLBACK_PASSWORD */
    ) {
      return NextResponse.json({
        success: true,
        username: username,
        permissions: {
          boss: true,
          purchase: true,
          stock: true,
          manageStock: true,
          users: true,
          backup: true,
          addSeller: true,
          purchaseReq: true,
          addOrder: true,
          addTransporter: true,
          addMyCompanies: true,
          addNewItem: true,
          addVendor: true,
          receivePurchaseRate: true,
          stockLastRate: true,
          printLabels: true,
          hideStockItem: true,
        },
      });
    }

    const client = await clientPromise;
    const db = client.db("dev_oms_db");

    // Search for the user in your 'users' folder
    const user = await db.collection("users").findOne({ username, password });

    if (!user) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      username: user.username,
      permissions: user.permissions,
    });
  } catch (error: any) {
    console.error("Database connection error details:", error);
    return NextResponse.json({ error: "Database connection failed", details: error.message }, { status: 500 });
  }
}
```

### Users API (user create, list aur edit; managerUsername yahin se set hota hai)

### `app/api/users/route.ts`

```ts
// FILE: app/api/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// GET: Fetch all users or specific user by username query param
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const username = searchParams.get("username");

    if (username) {
      const usernameLower = username.toLowerCase();
      if (usernameLower === "admin" || usernameLower === "chintan" || usernameLower === "hitesh") {
        return NextResponse.json({
          username: username,
          permissions: {
            boss: true,
            purchase: true,
            stock: true,
            manageStock: true,
            users: true,
            backup: true,
            addSeller: true,
            purchaseReq: true,
            addOrder: true,
            addTransporter: true,
            addMyCompanies: true,
            addNewItem: true,
            addVendor: true,
            receivePurchaseRate: true,
            stockLastRate: true,
            printLabels: true,
            hideStockItem: true,
          },
        });
      }
    }

    const client = await clientPromise;
    const db = client.db();

    if (username) {
      const user = await db.collection("users").findOne({ username });
      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      return NextResponse.json(user);
    }

    const users = await db.collection("users")
      .find({})
      .toArray();

    return NextResponse.json(users);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

// POST: Create a new user
export async function POST(req: Request) {
  try {
    const client = await clientPromise;
    const db = client.db();
    
    // Safety check for empty body
    const body = await req.json();
    if (!body || !body.username || !body.password) {
      return NextResponse.json({ error: "Username and Password are required" }, { status: 400 });
    }

    const { username, password, permissions } = body;

    // Check if user already exists
    const existingUser = await db.collection("users").findOne({ username });
    if (existingUser) {
      return NextResponse.json({ error: "Username already taken" }, { status: 400 });
    }

    const newUser = {
      username,
      password, // Plain text as requested
      permissions: permissions || {}, // Default to empty object if none provided
      createdAt: new Date(),
    };

    await db.collection("users").insertOne(newUser);
    return NextResponse.json({ message: "User created successfully" }, { status: 201 });
  } catch (error) {
    console.error("POST Error:", error);
    return NextResponse.json({ error: "Creation failed" }, { status: 500 });
  }
}
```

### `app/api/users/[id]/route.ts`

```ts
// FILE: app/api/users/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// PUT: Update user permissions or details
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const client = await clientPromise;
    const db = client.db();

    // 1. Await the params first!
    const { id } = await params; 

    // 2. Now the length check will work correctly
    if (!id || id.length !== 24) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }

    const body = await req.json();
    const { _id, ...updateData } = body;

    const result = await db.collection("users").updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "User updated successfully" });
  } catch (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

// DELETE: Remove a user
export async function DELETE(
  req: NextRequest, 
  { params }: { params: Promise<{ id: string }> } // Change: params is now a Promise
) {
  try {
    const client = await clientPromise;
    const db = client.db();
    
    // Await the params to extract the id
    const { id } = await params;

    if (!id || id.length !== 24) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }

    const result = await db.collection("users").deleteOne({
      _id: new ObjectId(id)
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "User deleted" });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
```

> ⚠️ **Gotcha:** `POST /api/users` naya user banate waqt sirf `username`, `password`, `permissions` save karta hai, **`managerUsername` save nahi karta**. Ye field sirf baad mein edit karne par (`PUT /api/users/[id]`) save hota hai, kyunki PUT poora body `$set` kar deta hai. Matlab user banane ke baad ek baar edit karke manager set karna padta hai.

### DB clients

### `lib/mongodb.ts`

```ts
// FILE: lib/mongodb.ts
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI as string;
const options = {};

let client;
let clientPromise: Promise<MongoClient>;

if (!process.env.MONGODB_URI) {
  throw new Error("Please add your Mongo URI to .env.local");
}

if (process.env.NODE_ENV === "development") {
  let globalWithMongo = global as typeof globalThis & {
    _mongoClientPromise?: Promise<MongoClient>;
  };

  if (!globalWithMongo._mongoClientPromise) {
    client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = client.connect();
  }
  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export default clientPromise; 
```

### `lib/dbConnect.ts`

```ts
// FILE: lib/dbConnect.ts
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable inside .env");
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development and prevent connection pool exhaustion in serverless environments.
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache | undefined;
}

let cached: MongooseCache = global.mongooseCache || { conn: null, promise: null };

if (!global.mongooseCache) {
  global.mongooseCache = cached;
}

async function dbConnect(): Promise<typeof mongoose> {
  if (cached.conn && cached.conn.connection.readyState === 1) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      maxPoolSize: 10, // Maintain up to 10 socket connections (Atlas M0 limit is 50 total)
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };

    cached.promise = mongoose.connect(MONGODB_URI!, opts).then((mongooseInstance) => {
      return mongooseInstance;
    }).catch((err) => {
      cached.promise = null;
      throw err;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default dbConnect;
```

### Login page (frontend)

### `app/login/page.tsx`

```tsx
// FILE: app/login/page.tsx
"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FiEye, FiEyeOff } from "react-icons/fi";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // If already logged in, send them to dashboard immediately
  useEffect(() => {
    if (localStorage.getItem("oms_user")) {
      router.push("/dashboard");
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (res.ok) {
        // MATCH KEY WITH LAYOUT
        localStorage.setItem("oms_user", JSON.stringify(data));
        router.push("/dashboard"); 
      } else {
        setError(data.error || "Login Failed");
        setLoading(false);
      }
    } catch (err) {
      setError("Server error");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020617] relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-900/20 blur-[120px] rounded-full"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-900/20 blur-[120px] rounded-full"></div>

      <div className="relative w-full max-w-md px-6">
        <form 
          onSubmit={handleLogin} 
          className="bg-white/5 backdrop-blur-xl p-10 rounded-3xl shadow-2xl border border-white/10 w-full"
        >
          <div className="mb-10 text-center">
            <h1 className="text-white text-3xl font-extrabold tracking-tight">Dev OMS</h1>
            <p className="text-slate-400 mt-2 text-sm">Order Management system</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-2xl flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
              <p className="text-red-400 text-[11px] font-medium uppercase tracking-wider">{error}</p>
            </div>
          )}

          <div className="space-y-5">
            <div className="group">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Username</label>
              <input 
                type="text" 
                placeholder="Enter Username" 
                required
                className="w-full p-4 bg-white/5 text-white rounded-2xl border border-white/10 outline-none transition-all focus:border-blue-500 focus:bg-white/10 placeholder:text-slate-600"
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="group">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Password</label>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"} 
                  placeholder="••••••••" 
                  required
                  className="w-full p-4 pr-12 bg-white/5 text-white rounded-2xl border border-white/10 outline-none transition-all focus:border-blue-500 focus:bg-white/10 placeholder:text-slate-600"
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <FiEyeOff size={18} /> : <FiEye size={18} />}
                </button>
              </div>
            </div>
          </div>

          <button 
            disabled={loading}
            className="w-full mt-10 bg-blue-600 text-white p-4 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl shadow-blue-900/20 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50"
          >
            {loading ? "Authenticating..." : "Login to Workspace"}
          </button>

          <p className="mt-8 text-center text-slate-500 text-[9px] font-black uppercase tracking-widest">
            © {new Date().getFullYear()} Dev OMS Architecture
          </p>
        </form>
      </div>
    </div>
  );
}
```

### Logout + idle timeout + TASKS badge (`components/Header.tsx` ke relevant hisse)

`Header.tsx` 637 lines ki file hai aur usme zyaadatar DEV OMS ka kaam hai (GeM login, pricelist, metal calc). Isliye sirf task/auth se juda code yahan diya hai:

```tsx
// components/Header.tsx  (sirf relevant hisse)
"use client";
import { FiLogOut, FiCheckSquare } from "react-icons/fi";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePendingTaskCount } from "@/lib/tasks/usePendingTaskCount";

export default function Header() {
  const router = useRouter();
  const [user, setUser] = useState<{ username: string, role: string } | null>(null);
  const { count: pendingTasks, pulse: pendingPulse } = usePendingTaskCount(user?.username ?? null);

  useEffect(() => {
    // 1. Next.js Guard: Ensure window is available
    if (typeof window === "undefined") return;

    const session = localStorage.getItem("oms_user");
    if (!session) {
      router.push("/login");
      return;
    }

    try {
      setUser(JSON.parse(session));
    } catch (e) {
      // Handles rare cases of corrupted local storage on mobile
      router.push("/login");
      return;
    }

    let logoutTimer: NodeJS.Timeout;

    const resetTimer = () => {
      if (logoutTimer) clearTimeout(logoutTimer);

      // 120 Minutes
      logoutTimer = setTimeout(() => {
        handleLogout();
        alert("Session expired due to inactivity.");
      }, 2 * 60 * 60 * 1000);
    };

    // 2. Optimized Mobile Events
    const activityEvents = ['touchstart', 'mousedown', 'click', 'keydown', 'scroll'];

    // 3. Add 'passive: true' for better mobile scrolling performance
    activityEvents.forEach(event => {
      window.addEventListener(event, resetTimer, { passive: true });
    });

    resetTimer();

    return () => {
      if (logoutTimer) clearTimeout(logoutTimer);
      activityEvents.forEach(event => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("oms_user");
    setUser(null);
    router.push("/login");
  };

  return (
    <header>
      {/* ...DEV OMS ke baaki buttons... */}

        {/* Tasks - assign / track / follow-up module */}
        <Link
          href="/dashboard/tasks"
          className="relative text-[10px] md:text-xs font-black uppercase tracking-wider bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/35 px-2 sm:px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer focus:outline-none"
          title={pendingTasks > 0 ? `Tasks (${pendingTasks} pending)` : "Tasks"}
        >
          <FiCheckSquare size={13} /> <span className="hidden sm:inline">Tasks</span>
          {pendingTasks > 0 && (
            <span
              className={`absolute -top-2 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black leading-[18px] text-center border border-[#0a2540] ${pendingPulse ? "animate-pulse" : ""}`}
            >
              {pendingTasks > 99 ? "99+" : pendingTasks}
            </span>
          )}
        </Link>

      {/* ...logout button: onClick={handleLogout} with <FiLogOut />... */}
    </header>
  );
}
```

### Root layout (login guard + GlobalTaskCreate mount) — relevant hissa

```tsx
// app/layout.tsx (sirf relevant hissa) - ye poora layout "use client" hai
"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Header from "@/components/Header";
import GlobalTaskCreate from "@/components/GlobalTaskCreate";
// DISABLED (Urgent Tasks): import UrgentTaskPopup from "@/components/UrgentTaskPopup";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";
  const [isLoading, setIsLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const user = localStorage.getItem("oms_user");
    if (isLoginPage) { setIsLoading(false); return; }
    if (!user) router.push("/login");
    else setIsLoading(false);
    // (DEV OMS yahan apne background jobs bhi trigger karta hai - task module ke liye zaroori nahi)
  }, [isLoginPage, router]);

  if (!isMounted) {
    return (<html lang="en"><body className="bg-[#f3f6f9]" suppressHydrationWarning /></html>);
  }

  return (
    <html lang="en">
      <body className="bg-[#f3f6f9] h-dvh overflow-hidden" suppressHydrationWarning>
        {isLoading && !isLoginPage ? (
          <div className="h-dvh flex items-center justify-center bg-[#f3f6f9]">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-blue-600"></div>
          </div>
        ) : !isLoginPage ? (
          <div className="flex flex-col h-full">
            <Header />
            <main className="flex-1 overflow-y-auto">{children}</main>
            {/* DISABLED (Urgent Tasks) - uncomment to re-enable: <UrgentTaskPopup /> */}
            <GlobalTaskCreate />
          </div>
        ) : (
          <main className="h-full">{children}</main>
        )}
      </body>
    </html>
  );
}
```

---

## 5. Roles & permissions

Task module ke **3 roles** hain. Ye `users.permissions` se nikalte hain (`getTaskRole`):

| Role | Kaise milta hai |
|---|---|
| **admin** | `permissions.boss === true`, **ya** username `admin` / `chintan` / `hitesh` (hardcoded super-admins) |
| **manager** | `permissions.taskManager === true` |
| **staff** | baaki sab |

**Manager ki team:** woh users jinka `managerUsername` is manager ka username ho. Agar manager ki team **khali** hai, to woh sab kuch dekhta hai aur kisi ko bhi assign kar sakta hai (admin jaisa, bas delete nahi kar sakta).

### Permission table

| Kaam | Admin | Manager | Staff |
|---|---|---|---|
| Kaunse tasks dikhenge | Sab | Jinme khud ya team assignee/assignedBy ho, ya khud watcher ho (team khali → sab) | Jinme khud assignee/assignedBy ho, ya watcher ho |
| Tabs | My, Watching, Assigned by Me, Team, All | My, Watching, Assigned by Me, Team | My, Watching, Assigned by Me |
| Task create | Kisi ke liye bhi | Khud ya team ke liye (team khali → kisi ke liye bhi) | **Sirf khud ke liye** |
| Past due date | Haan (warning ke saath) | Nahi | Nahi |
| Title, description, priority, due, firm, category, links, watchers edit | Haan | Haan (visible task par) | **Nahi** |
| Checklist items add/edit/remove | Haan | Haan | Nahi |
| Checklist tick/untick | Haan | Haan | Sirf apne (assignee) task par |
| Start / Waiting / Done / Resume | Haan | Haan | Sirf apne (assignee) task par |
| Cancel (reason ke saath) | Haan | Haan | **Nahi** |
| Reassign + bulk reassign | Kisi ko bhi | Khud/team ko | **Nahi** |
| Bulk priority | Haan | Haan | Nahi (PATCH priority staff ke liye 403) |
| Verify (DONE → CLOSED) | Haan | Haan | Nahi |
| Reject (DONE → IN_PROGRESS, reason ke saath) | Haan | Haan | Nahi |
| Reopen (CLOSED → OPEN, reason ke saath) | Haan | Haan | Nahi |
| Comment | Visible task par | Visible task par | Visible task par |
| Delete (soft) | **Sirf admin** | Nahi | Nahi |
| Urgent Tasks page (`/dashboard/urgent-tasks`) | Haan (`boss` permission se) | Nahi | Nahi |
| User banana / taskManager flag / managerUsername set karna | Jiske paas `users` permission ho (Settings page) | — | — |

**Status transitions** (`ALLOWED_TRANSITIONS`, `lib/tasks/types.ts`):

```
OPEN        → IN_PROGRESS | WAITING | DONE | CANCELLED
IN_PROGRESS → WAITING | DONE | CANCELLED
WAITING     → IN_PROGRESS | DONE | CANCELLED
DONE        → CLOSED (sirf /verify) | IN_PROGRESS (sirf /reject)
CLOSED      → OPEN (sirf /reopen)
CANCELLED   → (koi nahi)
```

`DONE` par agar `requiresVerification = false` ho to task turant `CLOSED` ho jaata hai.

### Role-check "middleware" — full code

### `lib/tasks/permissions.ts`

```ts
// FILE: lib/tasks/permissions.ts
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import type { TaskRole } from "./types";

export class TaskError extends Error {
  status: number;
  extra?: Record<string, any>;
  constructor(status: number, message: string, extra?: Record<string, any>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Same hardcoded super-admins as app/api/login + app/api/users: they may not
// exist in the users collection at all.
const HARDCODED_ADMINS = ["admin", "chintan", "hitesh"];

export function getTaskRole(user: { permissions?: Record<string, boolean> } | null | undefined): TaskRole {
  if (user?.permissions?.boss) return "admin";
  if (user?.permissions?.taskManager) return "manager";
  return "staff";
}

export interface TaskActor {
  username: string;
  role: TaskRole;
  /** Manager only: usernames whose managerUsername is this manager. Empty = no team set. */
  team: string[];
}

export function usersCollection() {
  const db = mongoose.connection.db;
  if (!db) throw new TaskError(500, "Database connection not initialized");
  return db.collection("users");
}

/**
 * Identify the acting user. Mirrors the existing routes (client sends the
 * username) but re-reads permissions from the DB on every request.
 * Known gap: a forged username can impersonate a user (spec D4 / section 11).
 */
export async function getActor(req: Request, bodyUsername?: string | null): Promise<TaskActor> {
  await dbConnect();
  const url = new URL(req.url);
  const username = (req.headers.get("x-oms-user") || url.searchParams.get("username") || bodyUsername || "").trim();
  if (!username) throw new TaskError(401, "Login karo pehle (user pehchaan nahi hui)");

  let role: TaskRole;
  if (HARDCODED_ADMINS.includes(username.toLowerCase())) {
    role = "admin";
  } else {
    const user = await usersCollection().findOne({ username }, { projection: { permissions: 1 } });
    if (!user) throw new TaskError(401, "User nahi mila, dobara login karo");
    role = getTaskRole(user as any);
  }

  let team: string[] = [];
  if (role === "manager") {
    const members = await usersCollection()
      .find({ managerUsername: username }, { projection: { username: 1 } })
      .toArray();
    team = members.map((m: any) => m.username);
  }
  return { username, role, team };
}

export const isManagerOrAdmin = (a: TaskActor) => a.role === "admin" || a.role === "manager";

/** Manager with no team members set sees/assigns everything (admin minus delete). */
export const managerSeesAll = (a: TaskActor) => a.role === "manager" && a.team.length === 0;

/** Mongo filter limiting tasks to the ones this actor may see (spec 2.2). */
export function visibilityFilter(a: TaskActor): Record<string, any> {
  if (a.role === "admin" || managerSeesAll(a)) return {};
  const people = a.role === "manager" ? [a.username, ...a.team] : [a.username];
  return {
    $or: [
      { assignee: { $in: people } },
      { assignedBy: { $in: people } },
      { watchers: a.username },
    ],
  };
}

export function canViewTask(a: TaskActor, t: { assignee: string; assignedBy: string; watchers?: string[] }): boolean {
  if (a.role === "admin" || managerSeesAll(a)) return true;
  const people = a.role === "manager" ? [a.username, ...a.team] : [a.username];
  return people.includes(t.assignee) || people.includes(t.assignedBy) || (t.watchers || []).includes(a.username);
}

/** May the actor assign (or reassign) work to `target`? */
export function canAssignTo(a: TaskActor, target: string): boolean {
  if (a.role === "admin") return true;
  if (a.role === "manager") return target === a.username || managerSeesAll(a) || a.team.includes(target);
  return target === a.username;
}
```

### `lib/tasks/http.ts`

```ts
// FILE: lib/tasks/http.ts
import { NextResponse } from "next/server";
import { TaskError } from "./permissions";

/** Parse a JSON body, tolerating empty/invalid bodies (POST actions without a payload). */
export async function readBody(req: Request): Promise<Record<string, any>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

/** Run a handler and map TaskError / validation errors to JSON responses. */
export async function respond(fn: () => Promise<any>, successStatus = 200) {
  try {
    const data = await fn();
    return NextResponse.json(data, { status: successStatus });
  } catch (err: any) {
    if (err instanceof TaskError) {
      return NextResponse.json({ error: err.message, ...(err.extra || {}) }, { status: err.status });
    }
    if (err?.name === "ValidationError") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Tasks API error:", err);
    return NextResponse.json({ error: err?.message || "Task request fail ho gayi" }, { status: 500 });
  }
}
```

### UI permission guard

### `components/BlockGuard.tsx`

```tsx
// FILE: components/BlockGuard.tsx
"use client";
import { useState, useEffect } from "react";

interface BlockGuardProps {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function BlockGuard({ permission, children, fallback = null }: BlockGuardProps) {
  const [user, setUser] = useState<any>(null);
  const [isMounted, setIsMounted] = useState(false);
  

  useEffect(() => {
    setIsMounted(true);
    const data = localStorage.getItem("oms_user");
    if (data) {
      const parsedUser = JSON.parse(data);
      setUser(parsedUser);

      // Fetch latest permissions dynamically from server to update session
      fetch(`/api/users?username=${encodeURIComponent(parsedUser.username)}`)
        .then(res => res.json())
        .then(updated => {
          if (updated && updated.permissions) {
            const freshSession = { ...parsedUser, permissions: updated.permissions };
            localStorage.setItem("oms_user", JSON.stringify(freshSession));
            setUser(freshSession);
          }
        })
        .catch(() => {});
    }
  }, []);

  if (!isMounted) return null;

  const usernameLower = user?.username?.trim().toLowerCase();
  const isSuperAdmin = ["chintan", "hitesh"].includes(usernameLower) || user?.permissions?.boss === true;

  // WHITELIST LOGIC: If the permission is 'true', or if the user is a super admin, they have access.
  const hasAccess = isSuperAdmin || (
    Array.isArray(permission)
      ? permission.some(p => user?.permissions?.[p] === true)
      : user?.permissions?.[permission] === true
  );

  if (!hasAccess) {
    return <>{fallback}</>; // Shows nothing or custom fallback
  }

  return <>{children}</>; // Shows the actual content
}
```

### Settings page (user management) — task se juda hissa

`app/dashboard/settings/page.tsx` (427 lines) DEV OMS ka poora user-access page hai. Task module ko isse sirf 2 cheezein chahiye: `taskManager` checkbox aur `managerUsername` input.

```tsx
// app/dashboard/settings/page.tsx (relevant hisse)
const initialState = {
    username: "",
    password: "",
    managerUsername: "",
    permissions: {
        // ...DEV OMS ki baaki permissions...
        boss: false,
        users: false,
        taskManager: false,
    },
};

// Permission checkbox groups me:
{
    title: "🛡️ System & Admin Pages",
    permissions: [
        { key: "boss", label: "Super Admin Bypass (Full Access)" },
        { key: "taskManager", label: "Task Manager (assign, verify, team tasks)" },
        { key: "users", label: "Settings / User Access Page" },
        // ...
    ],
},

// User edit karte waqt form me load:
//   managerUsername: user.managerUsername || "",
//   taskManager: user.permissions?.taskManager || false,

// Form input:
<input
    type="text"
    placeholder="Task manager username (optional - who manages this user's tasks)"
    value={formData.managerUsername || ""}
    className="p-3 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500 md:col-span-2"
    onChange={(e) => setFormData({ ...formData, managerUsername: e.target.value.trim() })}
/>
// Save: naya user -> POST /api/users ; existing user -> PUT /api/users/[id] (poora formData $set hota hai)
// Poora page BlockGuard permission="users" ke andar hai.
```

---

## 6. Database models

Collections: `users`, `tasks`, `task_activities`, `task_followups` (sirf schema), `task_settings` (sirf schema), `urgenttasks` (mongoose default naam), `counters`.

**Relations:** koi ObjectId ref nahi hai. Saare users **plain `username` string** se jude hain (`assignee`, `assignedBy`, `watchers`, `by`, `closedBy`, `doneBy`, `managerUsername`). `TaskActivity.taskId` aur `TaskFollowUp.taskId` = Task ka `_id` string ke roop mein. `counters` collection DEV OMS orders ke saath share hota hai (`_id: "orderId"`), aur task numbers `_id: "task-YYMM"` use karte hain.

### User

> Note: is file ke shuru mein `import mongoose` aur end mein `export` **nahi hai** (asli file aisi hi hai). Ye model kahin import nahi hota; login aur users API `mongodb` driver se seedha `users` collection padhte hain. Ye file sirf schema ka reference hai. DEV-BID mein use karni ho to upar `import mongoose from "mongoose";` aur neeche `export default mongoose.models.User || mongoose.model("User", userSchema);` jodna padega.

### `models/User.js`

```js
// FILE: models/User.js
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    permissions: {
        addSeller: { type: Boolean, default: false },
        purchaseReq: { type: Boolean, default: false },
        addOrder: { type: Boolean, default: false },
        addTransporter: { type: Boolean, default: false },
        addMyCompanies: { type: Boolean, default: false },
        stock: { type: Boolean, default: false },
        addNewItem: { type: Boolean, default: false },
        addVendor: { type: Boolean, default: false },
        purchase: { type: Boolean, default: false },
        boss: { type: Boolean, default: false },
        users: { type: Boolean, default: false },
        backup: { type: Boolean, default: false },
        manageStock: { type: Boolean, default: false },
        receivePurchaseRate: { type: Boolean, default: false },
        stockLastRate: { type: Boolean, default: false },
        printLabels: { type: Boolean, default: false },
        accountStatements: { type: Boolean, default: false },
        bankReconciliation: { type: Boolean, default: false },
        dashboardSummary: { type: Boolean, default: false },
        gemBids: { type: Boolean, default: false },
        advanceOrderTracker: { type: Boolean, default: false },
        // Standalone Delivery Challan module (Orders hub) - separate from the
        // order-derived challan download, which rides on order access.
        deliveryChallan: { type: Boolean, default: false },
        // Task module: manager role (admin is permissions.boss).
        taskManager: { type: Boolean, default: false },
        // Purchase > Pricelist module: view/tag, admin (upload, manual add, tag delete/merge), Received Purchase tab.
        pricelist: { type: Boolean, default: false },
        pricelistManage: { type: Boolean, default: false },
        pricelistReceived: { type: Boolean, default: false },
    },
    // Task module: a manager's team = users whose managerUsername is theirs.
    managerUsername: { type: String, default: null },
});
```

### Task

### `models/Task.ts`

```ts
// FILE: models/Task.ts
// @/models/Task.ts
import { Schema, model, models } from "mongoose";

// Users are referenced by plain `username` string everywhere (same as
// UrgentTask) - the app has no ObjectId-based user model for sessions.
const ChecklistItem = new Schema(
  {
    text: { type: String, required: true, maxlength: 300 },
    done: { type: Boolean, default: false },
    doneBy: String,
    doneAt: Date,
  },
  { _id: true }
);

const TaskSchema = new Schema(
  {
    taskNo: { type: String, unique: true, required: true },
    title: { type: String, required: true, maxlength: 200, trim: true },
    description: { type: String, maxlength: 5000, default: "" },

    category: {
      type: String,
      enum: ["ORDER", "DELIVERY", "BILLING", "PAYMENT_FOLLOWUP", "BID", "GEM_CATALOGUE", "DOCUMENT", "PURCHASE", "ACCOUNTS", "GENERAL"],
      default: "GENERAL",
    },
    priority: { type: String, enum: ["LOW", "NORMAL", "HIGH", "URGENT"], default: "NORMAL" },
    status: { type: String, enum: ["OPEN", "IN_PROGRESS", "WAITING", "DONE", "CLOSED", "CANCELLED"], default: "OPEN" },

    firm: { type: String, default: "" },

    // Plain ids + display strings, no refs.
    links: {
      sellerOrderId: String,
      gemOrderNo: String,
      bidId: String,
      bidNo: String,
      billId: String,
      billNo: String,
      buyerName: String,
      buyerPhone: String,
    },

    assignedBy: { type: String, required: true },
    assignee: { type: String, required: true },
    watchers: { type: [String], default: [] },

    dueAt: { type: Date, required: true },
    startedAt: Date,
    completedAt: Date,
    closedAt: Date,
    closedBy: String,

    requiresVerification: { type: Boolean, default: true },
    waitingOn: { type: String, enum: ["BUYER", "STAFF", "MATERIAL", "PAYMENT", "OTHER", null], default: null },
    nextFollowUpAt: Date,
    followUpCount: { type: Number, default: 0 },

    checklist: { type: [ChecklistItem], default: [] },

    // Kept now, used in later phases (no migration later).
    attachments: [{ name: String, r2Key: String, size: Number, mime: String, uploadedBy: String, uploadedAt: Date }],
    recurrence: {
      enabled: { type: Boolean, default: false },
      rule: { type: String, enum: ["DAILY", "WEEKLY", "MONTHLY", null], default: null },
      weekdays: [Number],
      dayOfMonth: Number,
      parentTaskId: String,
      nextRunAt: Date,
    },
    extensionRequest: {
      requestedDueAt: Date,
      reason: String,
      status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", null], default: null },
      requestedAt: Date,
      decidedBy: String,
    },
    escalationLevel: { type: Number, default: 0 },
    lastReminderAt: Date,

    tags: { type: [String], default: [] },
    isDeleted: { type: Boolean, default: false },
    source: {
      type: String,
      enum: ["WEB", "WHATSAPP", "RECURRING", "MIGRATED_TODO", "MIGRATED_URGENT", "AUTO"],
      default: "WEB",
    },
  },
  { timestamps: true, collection: "tasks" }
);

TaskSchema.index({ assignee: 1, status: 1, dueAt: 1 });
TaskSchema.index({ assignedBy: 1, status: 1 });
TaskSchema.index({ status: 1, nextFollowUpAt: 1 });
TaskSchema.index({ isDeleted: 1, dueAt: 1 });
TaskSchema.index({ "links.sellerOrderId": 1 });
TaskSchema.index({ "links.bidId": 1 });
TaskSchema.index({ "links.billId": 1 });
TaskSchema.index({ title: "text", description: "text", "links.buyerName": "text", "links.gemOrderNo": "text" });

export default models.Task || model("Task", TaskSchema);
```

### TaskActivity

### `models/TaskActivity.ts`

```ts
// FILE: models/TaskActivity.ts
// @/models/TaskActivity.ts
import { Schema, model, models } from "mongoose";

const TaskActivitySchema = new Schema(
  {
    taskId: { type: String, required: true, index: true },
    by: { type: String, default: null }, // username, null = system
    type: {
      type: String,
      required: true,
      enum: [
        "CREATED", "ASSIGNED", "REASSIGNED", "STATUS_CHANGED", "DUE_CHANGED", "PRIORITY_CHANGED", "EDITED",
        "COMMENT", "FOLLOWUP_ADDED", "CHECKLIST", "ATTACHMENT", "EXTENSION_REQUESTED", "EXTENSION_DECIDED",
        "ESCALATED", "REMINDER_SENT", "REOPENED", "VERIFIED", "REJECTED", "CANCELLED", "DELETED",
      ],
    },
    from: Schema.Types.Mixed,
    to: Schema.Types.Mixed,
    text: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "task_activities" }
);

TaskActivitySchema.index({ taskId: 1, createdAt: -1 });

export default models.TaskActivity || model("TaskActivity", TaskActivitySchema);
```

### TaskFollowUp (sirf schema, koi API nahi)

### `models/TaskFollowUp.ts`

```ts
// FILE: models/TaskFollowUp.ts
// @/models/TaskFollowUp.ts
// Schema only in Phase 1; the follow-up API and UI arrive in Phase 2.
import { Schema, model, models } from "mongoose";

const TaskFollowUpSchema = new Schema(
  {
    taskId: { type: String, required: true, index: true },
    by: { type: String, required: true },
    at: { type: Date, default: Date.now },
    mode: { type: String, enum: ["CALL", "WHATSAPP", "EMAIL", "VISIT", "GEM_PORTAL", "INTERNAL"], required: true },
    contactPerson: String,
    note: { type: String, required: true, maxlength: 2000 },
    outcome: { type: String, enum: ["POSITIVE", "NO_RESPONSE", "PROMISED", "NEGATIVE", "RESOLVED"], required: true },
    promisedDate: Date,
    nextFollowUpAt: Date,
  },
  { timestamps: true, collection: "task_followups" }
);

export default models.TaskFollowUp || model("TaskFollowUp", TaskFollowUpSchema);
```

### TaskSettings (sirf schema, kahin padha nahi jaata)

### `models/TaskSettings.ts`

```ts
// FILE: models/TaskSettings.ts
// @/models/TaskSettings.ts
// Single document (_id "default"). Schema only in Phase 1; read in P3,
// editable in P5.
import { Schema, model, models } from "mongoose";

const TaskSettingsSchema = new Schema(
  {
    _id: { type: String, default: "default" },
    workStartHour: { type: Number, default: 10 },
    workEndHour: { type: Number, default: 19 },
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
    dailyDigestTime: { type: String, default: "09:45" },
    eveningSummaryTime: { type: String, default: "18:30" },
    escalateToManagerAfterHours: { type: Number, default: 4 },
    escalateToAdminAfterHours: { type: Number, default: 24 },
    pauseSlaWhenWaiting: { type: Boolean, default: false },
    whatsappEnabled: { type: Boolean, default: true },
    whatsappMaxPerMinute: { type: Number, default: 8 },
    holidays: { type: [Date], default: [] },
  },
  { collection: "task_settings" }
);

export default models.TaskSettings || model("TaskSettings", TaskSettingsSchema);
```

### Counter (task number sequence)

### `models/Counter.ts`

```ts
// FILE: models/Counter.ts
// @/models/Counter.ts
// Shares the existing `counters` collection (orders already keeps
// { _id: "orderId", seq } there). Task numbers use _id "task-YYMM".
import { Schema, model, models } from "mongoose";

const CounterSchema = new Schema(
  { _id: { type: String }, seq: { type: Number, default: 0 } },
  { collection: "counters" }
);

export default models.Counter || model("Counter", CounterSchema);
```

### UrgentTask

### `models/UrgentTask.ts`

```ts
// FILE: models/UrgentTask.ts
// @/models/UrgentTask.ts
import mongoose, { Schema, model, models } from "mongoose";

// This app has no separate Staff/User Mongoose model or server-side auth
// session - every team member is identified by their plain `username` string
// (see app/api/login/route.ts, and localStorage's "oms_user"), so
// assignedTo/assignedBy are usernames here too, not ObjectId refs.
const UrgentTaskSchema = new Schema(
  {
    description: { type: String, required: true, trim: true },
    assignedTo: { type: String, required: true },
    assignedBy: { type: String, required: true },
    status: { type: String, enum: ["pending", "snoozed", "done"], default: "pending" },
    snoozeUntil: { type: Date, default: null },
    doneAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Powers both the assignee's "do I have anything due right now" poll and the
// owner dashboard's "everything still open" list.
UrgentTaskSchema.index({ assignedTo: 1, status: 1 });
UrgentTaskSchema.index({ status: 1, createdAt: 1 });

export default models.UrgentTask || model("UrgentTask", UrgentTaskSchema);
```

---

## 7. Backend APIs

Common rules (saare `/api/tasks/*` par lagte hain):
- **Identity:** header `x-oms-user: <username>`. Ye na ho to `?username=` query, aur woh bhi na ho to body ka `username`. Kuch na mile to `401`.
- **Errors:** `{ "error": "<Hinglish message>" }`, status 400 / 401 / 403 / 404 / 409 / 500. Mongoose validation error par 400.
- **Dates:** ISO string mein bhejein (jaise `"2026-11-25T12:30:00.000Z"`).

| Method | URL | Kaun | Request body / query | Response |
|---|---|---|---|---|
| GET | `/api/tasks` | Sab (visibility filter lagta hai) | Query: `view=my\|watching\|byme\|team\|all`, `status`, `priority`, `firm`, `category`, `assignee`, `overdue=true`, `stat=open\|dueToday\|overdue\|waiting\|followUpsToday\|toVerify`, `q`, `page`, `limit` (max 200, default 50), `sort=newest` | `{ tasks: Task[], total, page, limit }` |
| POST | `/api/tasks` | Sab (staff sirf khud ke liye) | `{ title*, dueAt*, description?, assignee?, priority?, category?, firm?, links?, watchers?: string[], checklist?: string[] \| {text}[], requiresVerification? }` | `201 { task, warning? }` |
| GET | `/api/tasks/:id` | Jisko task dikhta ho | — | `{ task, activities: TaskActivity[] (latest 200) }` |
| PATCH | `/api/tasks/:id` | Manager/admin: saare fields. Staff: sirf apne task ka checklist | `{ title?, description?, priority?, dueAt?, firm?, category?, links?, watchers?, checklist?: [{_id?, text, done}], expectedUpdatedAt? }` | `{ task }` |
| DELETE | `/api/tasks/:id` | Sirf admin (soft delete) | — | `{ success: true }` |
| POST | `/api/tasks/:id/status` | Manager/admin; staff sirf apne task par; Cancel sirf manager/admin | `{ status: "IN_PROGRESS"\|"WAITING"\|"DONE"\|"CANCELLED", waitingOn? (WAITING ke liye zaroori), nextFollowUpAt? (WAITING ke liye zaroori), reason? (CANCELLED ke liye zaroori) }` | `{ task }` |
| POST | `/api/tasks/:id/assign` | Manager (team) / admin | `{ assignee*, note? }` | `{ task }` |
| POST | `/api/tasks/:id/verify` | Manager/admin, sirf DONE task | `{}` | `{ task }` (status CLOSED) |
| POST | `/api/tasks/:id/reject` | Manager/admin, sirf DONE task | `{ reason* }` | `{ task }` (status IN_PROGRESS) |
| POST | `/api/tasks/:id/reopen` | Manager/admin, sirf CLOSED task | `{ reason* }` | `{ task }` (status OPEN) |
| POST | `/api/tasks/:id/comments` | Jisko task dikhta ho | `{ text* }` | `201 { activity }` |
| GET | `/api/tasks/summary` | Sab | `?view=` | `{ open, dueToday, overdue, waiting, followUpsToday, toVerify }` |
| GET | `/api/tasks/pending-count` | Sab (sirf apna) | — | `{ count }` |
| GET | `/api/tasks/users` | Sab | — | `[{ username, role, managerUsername, openCount, assignable }]` |
| GET | `/api/urgent-tasks?username=X` | Koi bhi (**koi auth check nahi**) | — | X ke due urgent tasks (`escalated`, `pendingMinutes` ke saath) |
| GET | `/api/urgent-tasks` | Koi bhi (**koi auth check nahi**) | — | Saare open urgent tasks |
| POST | `/api/urgent-tasks` | Koi bhi (UI sirf boss ko dikhata hai) | `{ description*, assignedTo*, assignedBy* }` | `201` task |
| PATCH | `/api/urgent-tasks/:id` | Koi bhi | `{ action: "done"\|"snooze" }` | task; already resolved ho to `409` |
| POST | `/api/login` | Public | `{ username, password }` | `{ success, username, permissions }` / `401` |
| GET/POST | `/api/users` | Koi bhi (**koi auth check nahi**; UI `users` permission se guard karta hai) | — / `{ username*, password*, permissions }` | users list / `201` |
| PUT/DELETE | `/api/users/:id` | Koi bhi (**koi auth check nahi**) | update fields | message |

**Response example: `POST /api/tasks`**

```json
// Request (header x-oms-user: ravi)
{ "title": "Buyer se PO copy mangwao", "assignee": "suresh", "dueAt": "2026-11-25T12:30:00.000Z",
  "priority": "HIGH", "category": "PAYMENT_FOLLOWUP", "firm": "Dev Enterprise",
  "links": { "buyerName": "ITI Rajkot", "gemOrderNo": "GEMC-511687..." },
  "watchers": ["chintan"], "checklist": ["Call karo", "Mail bhejo"] }

// 201 Response
{ "task": { "_id": "674...", "taskNo": "TSK-2611-0007", "title": "Buyer se PO copy mangwao",
  "status": "OPEN", "assignee": "suresh", "assignedBy": "ravi", "watchers": ["chintan"],
  "priority": "HIGH", "category": "PAYMENT_FOLLOWUP", "dueAt": "2026-11-25T12:30:00.000Z",
  "requiresVerification": true, "waitingOn": null, "followUpCount": 0,
  "checklist": [{ "_id": "...", "text": "Call karo", "done": false }, { "_id": "...", "text": "Mail bhejo", "done": false }],
  "isDeleted": false, "source": "WEB", "createdAt": "...", "updatedAt": "..." } }
```

**Error example:**

```json
// 403 - staff ne kisi aur ko assign karne ki koshish ki
{ "error": "Staff sirf apne naam par task bana sakte hain" }
// 409 - concurrent edit
{ "error": "Task kisi aur ne update kiya hai, refresh karo" }
```

### Shared types / helpers

### `lib/tasks/types.ts`

```ts
// FILE: lib/tasks/types.ts
// Shared task types/enums for the API routes and the dashboard UI.

export const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING", "DONE", "CLOSED", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_CATEGORIES = [
  "ORDER", "DELIVERY", "BILLING", "PAYMENT_FOLLOWUP", "BID",
  "GEM_CATALOGUE", "DOCUMENT", "PURCHASE", "ACCOUNTS", "GENERAL",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const WAITING_ON = ["BUYER", "STAFF", "MATERIAL", "PAYMENT", "OTHER"] as const;
export type WaitingOn = (typeof WAITING_ON)[number];

export type TaskRole = "admin" | "manager" | "staff";

/** Statuses in which a task is still live (overdue clock runs). */
export const ACTIVE_STATUSES: TaskStatus[] = ["OPEN", "IN_PROGRESS", "WAITING"];

/** Statuses that no longer count as "pending" for the navbar badge: DONE = "Done (verify)",
 *  CLOSED = "Done", CANCELLED = no longer anybody's work. Edit here to change the badge rule. */
export const DONE_STATUSES: TaskStatus[] = ["DONE", "CLOSED", "CANCELLED"];

/** Single source of truth for lifecycle transitions made via the status route.
 *  DONE -> CLOSED/IN_PROGRESS go through verify/reject, CLOSED -> OPEN through reopen. */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  OPEN: ["IN_PROGRESS", "WAITING", "DONE", "CANCELLED"],
  IN_PROGRESS: ["WAITING", "DONE", "CANCELLED"],
  WAITING: ["IN_PROGRESS", "DONE", "CANCELLED"],
  DONE: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["OPEN"],
  CANCELLED: [],
};

export interface ChecklistItemDTO {
  _id?: string;
  text: string;
  done: boolean;
  doneBy?: string;
  doneAt?: string;
}

export interface TaskDTO {
  _id: string;
  taskNo: string;
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  firm: string;
  links: {
    sellerOrderId?: string; gemOrderNo?: string; bidId?: string; bidNo?: string;
    billId?: string; billNo?: string; buyerName?: string; buyerPhone?: string;
  };
  assignedBy: string;
  assignee: string;
  watchers: string[];
  dueAt: string;
  startedAt?: string;
  completedAt?: string;
  closedAt?: string;
  closedBy?: string;
  requiresVerification: boolean;
  waitingOn: WaitingOn | null;
  nextFollowUpAt?: string;
  followUpCount: number;
  checklist: ChecklistItemDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskActivityDTO {
  _id: string;
  taskId: string;
  by: string | null;
  type: string;
  from?: any;
  to?: any;
  text: string;
  createdAt: string;
}

export interface TaskUserDTO {
  username: string;
  role: TaskRole;
  managerUsername: string | null;
  openCount: number;
  /** Whether the acting user may assign tasks to this person. */
  assignable: boolean;
}

export interface TaskSummaryDTO {
  open: number;
  dueToday: number;
  overdue: number;
  waiting: number;
  followUpsToday: number;
  toVerify: number;
}

export type TaskStatKey = "open" | "dueToday" | "overdue" | "waiting" | "followUpsToday" | "toVerify";
```

### `lib/tasks/ist.ts`

```ts
// FILE: lib/tasks/ist.ts
// Asia/Kolkata helpers. IST is a fixed UTC+5:30 (no DST), so plain offset
// arithmetic on UTC getters is exact and never depends on the server's local
// timezone (Vercel runs UTC, the dev machine runs IST).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** [start, end) of the IST calendar day containing `now`, as UTC instants. */
export function istDayBounds(now: Date = new Date()) {
  const startMs = Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

/** "YYMM" of the IST month containing `now`, e.g. "2610". */
export function istYYMM(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const yy = String(ist.getUTCFullYear()).slice(-2);
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}
```

### `lib/tasks/taskNumber.ts`

```ts
// FILE: lib/tasks/taskNumber.ts
import Counter from "@/models/Counter";
import { istYYMM } from "./ist";

/** TSK-YYMM-0001 - atomic per-month sequence stored in `counters` as "task-YYMM" (IST month). */
export async function generateTaskNo(now: Date = new Date()): Promise<string> {
  const yymm = istYYMM(now);

  const counter = await Counter.findOneAndUpdate(
    { _id: `task-${yymm}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `TSK-${yymm}-${String(counter.seq).padStart(4, "0")}`;
}
```

### Service layer (saare business rules yahin hain)

### `lib/tasks/taskService.ts`

```ts
// FILE: lib/tasks/taskService.ts
import mongoose from "mongoose";
import Task from "@/models/Task";
import TaskActivity from "@/models/TaskActivity";
import { generateTaskNo } from "./taskNumber";
import { istDayBounds } from "./ist";
import {
  TaskActor, TaskError, canAssignTo, canViewTask, getTaskRole, isManagerOrAdmin, usersCollection, visibilityFilter,
} from "./permissions";
import {
  ACTIVE_STATUSES, ALLOWED_TRANSITIONS, DONE_STATUSES, TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES, WAITING_ON,
  TaskStatKey, TaskStatus,
} from "./types";

// All lifecycle rules, permission checks and activity logging live here so the
// route files stay thin (spec section 3 / 5).

const CONFLICT_MSG = "Task kisi aur ne update kiya hai, refresh karo";
const LINK_KEYS = ["sellerOrderId", "gemOrderNo", "bidId", "bidNo", "billId", "billNo", "buyerName", "buyerPhone"] as const;

/* ------------------------------------------------------------------ helpers */

const str = (v: any, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function parseDate(v: any, label: string): Date {
  const d = v ? new Date(v) : null;
  if (!d || isNaN(d.getTime())) throw new TaskError(400, `${label} sahi date nahi hai`);
  return d;
}

function cleanLinks(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const k of LINK_KEYS) {
      const v = str(raw[k], 200);
      if (v) out[k] = v;
    }
  }
  return out;
}

async function existingUsernames(names: string[]): Promise<Set<string>> {
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return new Set();
  const found = await usersCollection().find({ username: { $in: unique } }, { projection: { username: 1 } }).toArray();
  const set = new Set<string>(found.map((u: any) => u.username));
  // hardcoded admins may not be stored in the users collection
  for (const n of unique) if (["admin", "chintan", "hitesh"].includes(n.toLowerCase())) set.add(n);
  return set;
}

async function assertUserExists(username: string) {
  if (!(await existingUsernames([username])).has(username)) {
    throw new TaskError(400, `User "${username}" nahi mila`);
  }
}

async function logActivity(taskId: any, by: string | null, type: string, text = "", from?: any, to?: any) {
  await TaskActivity.create({ taskId: String(taskId), by, type, text, from, to });
}

async function loadTask(actor: TaskActor, id: string) {
  if (!mongoose.isValidObjectId(id)) throw new TaskError(404, "Task nahi mila");
  const task: any = await Task.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
  if (!task) throw new TaskError(404, "Task nahi mila");
  if (!canViewTask(actor, task)) throw new TaskError(403, "Is task ko dekhne ki permission nahi hai");
  return task;
}

/** Update guarded by the loaded updatedAt, so concurrent edits give a 409 instead of overwriting. */
async function applyUpdate(task: any, set: Record<string, any>, unset: string[] = []) {
  const update: any = { $set: set };
  if (unset.length) update.$unset = Object.fromEntries(unset.map((k) => [k, 1]));
  const updated: any = await Task.findOneAndUpdate(
    { _id: task._id, updatedAt: task.updatedAt, isDeleted: { $ne: true } },
    update,
    { new: true }
  ).lean();
  if (!updated) throw new TaskError(409, CONFLICT_MSG);
  return updated;
}

function requireReason(body: any, what: string): string {
  const reason = str(body?.reason, 1000);
  if (!reason) throw new TaskError(400, `${what} ke liye reason likhna zaroori hai`);
  return reason;
}

/* ------------------------------------------------------------------- create */

export async function createTask(actor: TaskActor, body: any) {
  const title = str(body.title, 200);
  if (!title) throw new TaskError(400, "Title zaroori hai");
  if (typeof body.title === "string" && body.title.trim().length > 200) throw new TaskError(400, "Title 200 characters se zyada nahi ho sakta");

  const description = str(body.description, 5000);
  const assignee = str(body.assignee, 100) || actor.username;
  if (!canAssignTo(actor, assignee)) {
    throw new TaskError(
      403,
      actor.role === "staff" ? "Staff sirf apne naam par task bana sakte hain" : "Aap sirf apni team ko task assign kar sakte ho"
    );
  }
  await assertUserExists(assignee);

  const dueAt = parseDate(body.dueAt, "Due date");
  let warning: string | undefined;
  if (dueAt.getTime() < Date.now() - 60 * 1000) {
    if (actor.role !== "admin") throw new TaskError(400, "Due date past mein nahi ho sakti");
    warning = "Due date past mein hai - task turant overdue dikhega";
  }

  const priority = body.priority ?? "NORMAL";
  if (!TASK_PRIORITIES.includes(priority)) throw new TaskError(400, "Priority sahi nahi hai");
  const category = body.category ?? "GENERAL";
  if (!TASK_CATEGORIES.includes(category)) throw new TaskError(400, "Category sahi nahi hai");

  const watcherNames: string[] = Array.isArray(body.watchers) ? body.watchers.map((w: any) => str(w, 100)) : [];
  const knownWatchers = await existingUsernames(watcherNames);
  const watchers = [...new Set(watcherNames)].filter((w) => w && w !== assignee && knownWatchers.has(w));

  const checklist = (Array.isArray(body.checklist) ? body.checklist : [])
    .map((c: any) => str(typeof c === "string" ? c : c?.text, 300))
    .filter(Boolean)
    .slice(0, 50)
    .map((text: string) => ({ text, done: false }));

  const task = await Task.create({
    taskNo: await generateTaskNo(),
    title,
    description,
    category,
    priority,
    firm: str(body.firm, 100),
    links: cleanLinks(body.links),
    assignedBy: actor.username,
    assignee,
    watchers,
    dueAt,
    requiresVerification: typeof body.requiresVerification === "boolean" ? body.requiresVerification : true,
    checklist,
    source: "WEB",
  });

  await logActivity(
    task._id, actor.username, "CREATED",
    assignee === actor.username ? "Task banaya" : `Task banaya, ${assignee} ko assign kiya`,
    null, { assignee, dueAt, priority }
  );
  return { task: task.toObject(), ...(warning ? { warning } : {}) };
}

/* --------------------------------------------------------------------- list */

function viewFilter(actor: TaskActor, view: string): Record<string, any> {
  switch (view) {
    case "byme":
      return { assignedBy: actor.username };
    case "watching":
      return { watchers: actor.username };
    case "team":
      if (actor.role === "staff") throw new TaskError(403, "Team view sirf manager/admin ke liye hai");
      return {};
    case "all":
      if (actor.role === "staff") throw new TaskError(403, "All view sirf manager/admin ke liye hai");
      return {};
    default: // "my" - tasks I own; tasks I only watch live under "watching"
      return { assignee: actor.username };
  }
}

function statFilter(key: TaskStatKey, now: Date): Record<string, any> {
  const { start, end } = istDayBounds(now);
  switch (key) {
    case "open": return { status: { $in: ACTIVE_STATUSES } };
    case "dueToday": return { status: { $in: ACTIVE_STATUSES }, dueAt: { $gte: start, $lt: end } };
    case "overdue": return { status: { $in: ACTIVE_STATUSES }, dueAt: { $lt: now } };
    case "waiting": return { status: "WAITING" };
    case "followUpsToday": return { status: { $nin: ["CLOSED", "CANCELLED"] }, nextFollowUpAt: { $lt: end } };
    case "toVerify": return { status: "DONE" };
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function baseFilter(actor: TaskActor, view: string): Record<string, any> {
  const parts: Record<string, any>[] = [{ isDeleted: { $ne: true } }];
  const vis = visibilityFilter(actor);
  if (Object.keys(vis).length) parts.push(vis);
  const vf = viewFilter(actor, view);
  if (Object.keys(vf).length) parts.push(vf);
  return { $and: parts };
}

export async function listTasks(actor: TaskActor, sp: URLSearchParams) {
  const now = new Date();
  const view = sp.get("view") || "my";
  const parts: Record<string, any>[] = [baseFilter(actor, view)];

  const status = sp.get("status");
  if (status) {
    if (!TASK_STATUSES.includes(status as TaskStatus)) throw new TaskError(400, "Status sahi nahi hai");
    parts.push({ status });
  }
  for (const key of ["priority", "firm", "category", "assignee"] as const) {
    const v = sp.get(key);
    if (v) parts.push({ [key]: v });
  }
  if (sp.get("overdue") === "true") parts.push(statFilter("overdue", now));
  const stat = sp.get("stat") as TaskStatKey | null;
  if (stat) {
    const f = statFilter(stat, now);
    if (!f) throw new TaskError(400, "Stat sahi nahi hai");
    parts.push(f);
  }
  const q = (sp.get("q") || "").trim().slice(0, 100);
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    parts.push({ $or: [{ taskNo: rx }, { title: rx }, { description: rx }, { assignee: rx }, { "links.buyerName": rx }, { "links.gemOrderNo": rx }] });
  }

  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") || "50", 10) || 50));
  const match = { $and: parts };

  const sortStage: Record<string, 1 | -1> =
    sp.get("sort") === "newest" ? { createdAt: -1, _id: -1 } : { _rank: 1, dueAt: 1, _id: 1 };

  const [tasks, total] = await Promise.all([
    Task.aggregate([
      { $match: match },
      {
        $addFields: {
          _rank: {
            $switch: {
              branches: [
                { case: { $and: [{ $in: ["$status", ACTIVE_STATUSES] }, { $lt: ["$dueAt", now] }] }, then: 0 },
                { case: { $in: ["$status", ACTIVE_STATUSES] }, then: 1 },
                { case: { $eq: ["$status", "DONE"] }, then: 2 },
              ],
              default: 3,
            },
          },
        },
      },
      { $sort: sortStage },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      { $project: { _rank: 0 } },
    ]),
    Task.countDocuments(match),
  ]);

  return { tasks, total, page, limit };
}

export async function taskSummary(actor: TaskActor, view: string) {
  const now = new Date();
  const base = baseFilter(actor, view);
  const keys: TaskStatKey[] = ["open", "dueToday", "overdue", "waiting", "followUpsToday", "toVerify"];
  const counts = await Promise.all(keys.map((k) => Task.countDocuments({ $and: [base, statFilter(k, now)] })));
  return Object.fromEntries(keys.map((k, i) => [k, counts[i]]));
}

/** Navbar badge: tasks assigned to the acting user that are not done (uses the assignee+status index). */
export async function pendingTaskCount(actor: TaskActor) {
  const count = await Task.countDocuments({
    assignee: actor.username,
    status: { $nin: DONE_STATUSES },
    isDeleted: { $ne: true },
  });
  return { count };
}

/* ------------------------------------------------------------------- detail */

export async function getTaskDetail(actor: TaskActor, id: string) {
  const task = await loadTask(actor, id);
  const activities = await TaskActivity.find({ taskId: String(task._id) }).sort({ createdAt: -1 }).limit(200).lean();
  return { task, activities };
}

/* -------------------------------------------------------------------- patch */

export async function patchTask(actor: TaskActor, id: string, body: any) {
  const task = await loadTask(actor, id);

  if (body.expectedUpdatedAt && new Date(body.expectedUpdatedAt).getTime() !== new Date(task.updatedAt).getTime()) {
    throw new TaskError(409, CONFLICT_MSG);
  }
  if (task.status === "CLOSED" || task.status === "CANCELLED") {
    throw new TaskError(400, "Closed/Cancelled task edit nahi ho sakta (pehle Reopen karo)");
  }

  const mgr = isManagerOrAdmin(actor);
  const FIELDS = ["title", "description", "priority", "dueAt", "firm", "category", "links", "watchers", "checklist"];
  const touched = FIELDS.filter((f) => body[f] !== undefined);
  if (!mgr) {
    if (task.assignee !== actor.username) throw new TaskError(403, "Sirf apne task ka checklist update kar sakte ho");
    if (touched.some((f) => f !== "checklist")) throw new TaskError(403, "Staff sirf checklist tick kar sakta hai");
  }

  const set: Record<string, any> = {};
  const acts: { type: string; text: string; from?: any; to?: any }[] = [];
  const editedFields: string[] = [];

  if (body.title !== undefined) {
    const title = str(body.title, 200);
    if (!title) throw new TaskError(400, "Title khali nahi ho sakta");
    if (title !== task.title) { set.title = title; editedFields.push("title"); }
  }
  if (body.description !== undefined) {
    const d = str(body.description, 5000);
    if (d !== task.description) { set.description = d; editedFields.push("description"); }
  }
  if (body.firm !== undefined) {
    const f = str(body.firm, 100);
    if (f !== task.firm) { set.firm = f; editedFields.push("firm"); }
  }
  if (body.category !== undefined) {
    if (!TASK_CATEGORIES.includes(body.category)) throw new TaskError(400, "Category sahi nahi hai");
    if (body.category !== task.category) { set.category = body.category; editedFields.push("category"); }
  }
  if (body.links !== undefined) {
    set.links = cleanLinks(body.links);
    editedFields.push("links");
  }
  if (body.watchers !== undefined) {
    const names: string[] = (Array.isArray(body.watchers) ? body.watchers : []).map((w: any) => str(w, 100));
    const known = await existingUsernames(names);
    const watchers = [...new Set(names)].filter((w) => w && w !== task.assignee && known.has(w));
    if (watchers.join("|") !== (task.watchers || []).join("|")) { set.watchers = watchers; editedFields.push("watchers"); }
  }
  if (body.priority !== undefined) {
    if (!TASK_PRIORITIES.includes(body.priority)) throw new TaskError(400, "Priority sahi nahi hai");
    if (body.priority !== task.priority) {
      set.priority = body.priority;
      acts.push({ type: "PRIORITY_CHANGED", text: `Priority ${task.priority} → ${body.priority}`, from: task.priority, to: body.priority });
    }
  }
  if (body.dueAt !== undefined) {
    const dueAt = parseDate(body.dueAt, "Due date");
    if (dueAt.getTime() !== new Date(task.dueAt).getTime()) {
      if (dueAt.getTime() < Date.now() - 60 * 1000 && actor.role !== "admin") {
        throw new TaskError(400, "Due date past mein nahi ho sakti");
      }
      set.dueAt = dueAt;
      acts.push({ type: "DUE_CHANGED", text: "Due date badli", from: task.dueAt, to: dueAt });
    }
  }
  if (body.checklist !== undefined) {
    if (!Array.isArray(body.checklist)) throw new TaskError(400, "Checklist sahi format mein nahi hai");
    const existing: any[] = task.checklist || [];
    const byId = new Map(existing.map((c) => [String(c._id), c]));
    const now = new Date();
    let next: any[];

    if (mgr) {
      next = body.checklist.slice(0, 50).map((c: any) => {
        const text = str(c?.text, 300);
        if (!text) throw new TaskError(400, "Checklist item khali nahi ho sakta");
        const old = c?._id ? byId.get(String(c._id)) : null;
        const done = !!c?.done;
        if (old) {
          const changed = old.done !== done;
          return { _id: old._id, text, done, doneBy: changed ? (done ? actor.username : undefined) : old.doneBy, doneAt: changed ? (done ? now : undefined) : old.doneAt };
        }
        return { text, done, doneBy: done ? actor.username : undefined, doneAt: done ? now : undefined };
      });
    } else {
      // staff: only flip `done` on items that already exist
      const wanted = new Map<string, boolean>(body.checklist.filter((c: any) => c?._id).map((c: any) => [String(c._id), !!c.done]));
      next = existing.map((old) => {
        const done = wanted.has(String(old._id)) ? wanted.get(String(old._id))! : old.done;
        if (done === old.done) return old;
        return { ...old, done, doneBy: done ? actor.username : undefined, doneAt: done ? now : undefined };
      });
    }

    const sig = (list: any[]) => list.map((c) => `${c._id || ""}:${c.text}:${c.done ? 1 : 0}`).join("|");
    if (sig(next) !== sig(existing)) {
      set.checklist = next;
      const doneNow = next.filter((c) => c.done).length;
      acts.push({ type: "CHECKLIST", text: `Checklist update: ${doneNow}/${next.length} done` });
    }
  }

  if (editedFields.length) acts.unshift({ type: "EDITED", text: `Edited: ${editedFields.join(", ")}` });
  if (!Object.keys(set).length) return { task };

  const updated = await applyUpdate(task, set);
  for (const a of acts) await logActivity(task._id, actor.username, a.type, a.text, a.from, a.to);
  return { task: updated };
}

/* ------------------------------------------------------------------- status */

export async function changeStatus(actor: TaskActor, id: string, body: any) {
  const task = await loadTask(actor, id);
  const to = body.status as TaskStatus;
  if (!TASK_STATUSES.includes(to)) throw new TaskError(400, "Status sahi nahi hai");
  const from = task.status as TaskStatus;

  if (from === to) throw new TaskError(400, "Task pehle se isi status mein hai");
  if (from === "DONE") throw new TaskError(400, "Done task ko Verify ya Reject karo");
  if (from === "CLOSED") throw new TaskError(400, "Closed task ko Reopen karo");
  if (to === "CLOSED") throw new TaskError(400, "Close karne ke liye Verify use karo");
  if (!ALLOWED_TRANSITIONS[from].includes(to)) throw new TaskError(400, `${from} se ${to} allowed nahi hai`);

  const mgr = isManagerOrAdmin(actor);
  if (!mgr && task.assignee !== actor.username) throw new TaskError(403, "Staff sirf apne task ka status badal sakta hai");
  if (to === "CANCELLED" && !mgr) throw new TaskError(403, "Task cancel sirf manager/admin kar sakte hain");

  const now = new Date();
  const set: Record<string, any> = { status: to };
  const unset: string[] = [];
  const acts: { type: string; text: string; from?: any; to?: any }[] = [];
  let reason = "";

  if (to === "CANCELLED") {
    reason = requireReason(body, "Cancel");
    acts.push({ type: "CANCELLED", text: `Cancelled: ${reason}`, from, to });
    set.waitingOn = null;
  } else if (to === "WAITING") {
    if (!WAITING_ON.includes(body.waitingOn)) throw new TaskError(400, "Waiting ke liye 'kiska wait' (waitingOn) chuno");
    if (!body.nextFollowUpAt) throw new TaskError(400, "Waiting ke liye next follow-up date zaroori hai");
    set.waitingOn = body.waitingOn;
    set.nextFollowUpAt = parseDate(body.nextFollowUpAt, "Next follow-up");
    acts.push({ type: "STATUS_CHANGED", text: `Waiting on ${body.waitingOn}`, from, to });
  } else if (to === "IN_PROGRESS") {
    set.waitingOn = null;
    if (!task.startedAt) set.startedAt = now;
    acts.push({ type: "STATUS_CHANGED", text: from === "WAITING" ? "Kaam dobara shuru" : "Kaam shuru", from, to });
  } else if (to === "DONE") {
    set.waitingOn = null;
    set.completedAt = now;
    acts.push({ type: "STATUS_CHANGED", text: "Done mark kiya", from, to });
    if (!task.requiresVerification) {
      set.status = "CLOSED";
      set.closedAt = now;
      set.closedBy = actor.username;
      acts.push({ type: "VERIFIED", text: "Auto-closed (verification zaroori nahi)", from: "DONE", to: "CLOSED" });
    }
  }

  const updated = await applyUpdate(task, set, unset);
  for (const a of acts) await logActivity(task._id, actor.username, a.type, a.text, a.from, a.to);
  return { task: updated };
}

/* ------------------------------------------------------------------- assign */

export async function assignTask(actor: TaskActor, id: string, body: any) {
  if (!isManagerOrAdmin(actor)) throw new TaskError(403, "Reassign sirf manager/admin kar sakte hain");
  const task = await loadTask(actor, id);
  if (task.status === "CLOSED" || task.status === "CANCELLED") throw new TaskError(400, "Closed/Cancelled task reassign nahi hota");

  const assignee = str(body.assignee, 100);
  if (!assignee) throw new TaskError(400, "Assignee chuno");
  if (assignee === task.assignee) throw new TaskError(400, "Task pehle se isi ke paas hai");
  if (!canAssignTo(actor, assignee)) throw new TaskError(403, "Aap sirf apni team ko task assign kar sakte ho");
  await assertUserExists(assignee);

  // Old assignee stays in the loop as a watcher; new one is removed from watchers.
  const watchers = [...new Set([...(task.watchers || []), task.assignee])].filter((w) => w !== assignee);
  const note = str(body.note, 500);
  const updated = await applyUpdate(task, { assignee, watchers });
  await logActivity(task._id, actor.username, "REASSIGNED", `${task.assignee} → ${assignee}${note ? `: ${note}` : ""}`, task.assignee, assignee);
  return { task: updated };
}

/* ----------------------------------------------------- verify/reject/reopen */

export async function verifyTask(actor: TaskActor, id: string) {
  if (!isManagerOrAdmin(actor)) throw new TaskError(403, "Verify sirf manager/admin kar sakte hain");
  const task = await loadTask(actor, id);
  if (task.status !== "DONE") throw new TaskError(400, "Sirf Done task verify ho sakta hai");
  const now = new Date();
  const updated = await applyUpdate(task, { status: "CLOSED", closedAt: now, closedBy: actor.username });
  await logActivity(task._id, actor.username, "VERIFIED", "Verify karke close kiya", "DONE", "CLOSED");
  return { task: updated };
}

export async function rejectTask(actor: TaskActor, id: string, body: any) {
  if (!isManagerOrAdmin(actor)) throw new TaskError(403, "Reject sirf manager/admin kar sakte hain");
  const task = await loadTask(actor, id);
  if (task.status !== "DONE") throw new TaskError(400, "Sirf Done task reject ho sakta hai");
  const reason = requireReason(body, "Reject");
  const updated = await applyUpdate(task, { status: "IN_PROGRESS" }, ["completedAt"]);
  await logActivity(task._id, actor.username, "REJECTED", `Rejected: ${reason}`, "DONE", "IN_PROGRESS");
  return { task: updated };
}

export async function reopenTask(actor: TaskActor, id: string, body: any) {
  if (!isManagerOrAdmin(actor)) throw new TaskError(403, "Reopen sirf manager/admin kar sakte hain");
  const task = await loadTask(actor, id);
  if (task.status !== "CLOSED") throw new TaskError(400, "Sirf Closed task reopen ho sakta hai");
  const reason = requireReason(body, "Reopen");
  const updated = await applyUpdate(task, { status: "OPEN" }, ["completedAt", "closedAt", "closedBy"]);
  await logActivity(task._id, actor.username, "REOPENED", `Reopened: ${reason}`, "CLOSED", "OPEN");
  return { task: updated };
}

/* ----------------------------------------------------------------- comments */

export async function addComment(actor: TaskActor, id: string, body: any) {
  const task = await loadTask(actor, id);
  const text = str(body.text, 2000);
  if (!text) throw new TaskError(400, "Comment khali nahi ho sakta");

  const handles = [...text.matchAll(/@([A-Za-z0-9_.-]+)/g)].map((m) => m[1]);
  const mentions = handles.length ? [...(await existingUsernames(handles))] : [];

  const activity = await TaskActivity.create({ taskId: String(task._id), by: actor.username, type: "COMMENT", text, to: mentions });
  return { activity: activity.toObject() };
}

/* ------------------------------------------------------------------- delete */

export async function softDeleteTask(actor: TaskActor, id: string) {
  if (actor.role !== "admin") throw new TaskError(403, "Task delete sirf admin kar sakta hai");
  const task = await loadTask(actor, id);
  await applyUpdate(task, { isDeleted: true });
  await logActivity(task._id, actor.username, "DELETED", "Task delete kiya");
  return { success: true };
}

/* -------------------------------------------------------------------- users */

export async function listTaskUsers(actor: TaskActor) {
  const [users, counts] = await Promise.all([
    usersCollection().find({}, { projection: { username: 1, permissions: 1, managerUsername: 1 } }).toArray(),
    Task.aggregate([
      { $match: { isDeleted: { $ne: true }, status: { $in: ACTIVE_STATUSES } } },
      { $group: { _id: "$assignee", n: { $sum: 1 } } },
    ]),
  ]);
  const open = new Map<string, number>(counts.map((c: any) => [c._id, c.n]));

  const rows = users.map((u: any) => ({
    username: u.username as string,
    role: ["admin", "chintan", "hitesh"].includes(String(u.username).toLowerCase()) ? ("admin" as const) : getTaskRole(u),
    managerUsername: (u.managerUsername as string) || null,
  }));
  for (const name of ["admin", "chintan", "hitesh"]) {
    if (!rows.some((r) => r.username.toLowerCase() === name)) rows.push({ username: name, role: "admin", managerUsername: null });
  }

  return rows
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((r) => ({ ...r, openCount: open.get(r.username) || 0, assignable: canAssignTo(actor, r.username) }));
}
```

### Route files

### `app/api/tasks/route.ts`

```ts
// FILE: app/api/tasks/route.ts
import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { createTask, listTasks } from "@/lib/tasks/taskService";

// GET /api/tasks?view=my|byme|team|all&status=&priority=&firm=&category=&assignee=&overdue=true&stat=&q=&page=&limit=&sort=
export async function GET(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return listTasks(actor, new URL(req.url).searchParams);
  });
}

// POST /api/tasks - create
export async function POST(req: Request) {
  return respond(async () => {
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return createTask(actor, body);
  }, 201);
}
```

### `app/api/tasks/[id]/route.ts`

```ts
// FILE: app/api/tasks/[id]/route.ts
import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { getTaskDetail, patchTask, softDeleteTask } from "@/lib/tasks/taskService";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return respond(async () => {
    const { id } = await params;
    const actor = await getActor(req);
    return getTaskDetail(actor, id);
  });
}

// PATCH body may carry expectedUpdatedAt for the optimistic lock (409 on mismatch).
export async function PATCH(req: Request, { params }: Ctx) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return patchTask(actor, id, body);
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return respond(async () => {
    const { id } = await params;
    const actor = await getActor(req);
    return softDeleteTask(actor, id);
  });
}
```

### `app/api/tasks/[id]/status/route.ts`

```ts
// FILE: app/api/tasks/[id]/status/route.ts
import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { changeStatus } from "@/lib/tasks/taskService";

// POST { status, reason?, waitingOn?, nextFollowUpAt? } - Start / Waiting / Done / Resume / Cancel
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return changeStatus(actor, id, body);
  });
}
```

### `app/api/tasks/[id]/assign/route.ts`

```ts
// FILE: app/api/tasks/[id]/assign/route.ts
import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { assignTask } from "@/lib/tasks/taskService";

// POST { assignee, note? } - reassign (manager team / admin)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return assignTask(actor, id, body);
  });
}
```

### `app/api/tasks/[id]/verify/route.ts`

```ts
// FILE: app/api/tasks/[id]/verify/route.ts
import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { verifyTask } from "@/lib/tasks/taskService";

// POST - DONE -> CLOSED (manager/admin)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return verifyTask(actor, id);
  });
}
```

### `app/api/tasks/[id]/reject/route.ts`

```ts
// FILE: app/api/tasks/[id]/reject/route.ts
import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { rejectTask } from "@/lib/tasks/taskService";

// POST { reason } - DONE -> IN_PROGRESS (manager/admin)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return rejectTask(actor, id, body);
  });
}
```

### `app/api/tasks/[id]/reopen/route.ts`

```ts
// FILE: app/api/tasks/[id]/reopen/route.ts
import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { reopenTask } from "@/lib/tasks/taskService";

// POST { reason } - CLOSED -> OPEN (manager/admin)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return reopenTask(actor, id, body);
  });
}
```

### `app/api/tasks/[id]/comments/route.ts`

```ts
// FILE: app/api/tasks/[id]/comments/route.ts
import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { addComment } from "@/lib/tasks/taskService";

// POST { text } - internal comment, @username mentions stored in activity.to
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const actor = await getActor(req, body.username);
    return addComment(actor, id, body);
  }, 201);
}
```

### `app/api/tasks/summary/route.ts`

```ts
// FILE: app/api/tasks/summary/route.ts
import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { taskSummary } from "@/lib/tasks/taskService";

// GET /api/tasks/summary?view=my|byme|team|all - counts for the stats row
export async function GET(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return taskSummary(actor, new URL(req.url).searchParams.get("view") || "my");
  });
}
```

### `app/api/tasks/pending-count/route.ts`

```ts
// FILE: app/api/tasks/pending-count/route.ts
import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { pendingTaskCount } from "@/lib/tasks/taskService";

// GET /api/tasks/pending-count -> { count } for the TASKS navbar badge.
// Always the acting user's own tasks (identity from the x-oms-user header, never a userId param).
export async function GET(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return pendingTaskCount(actor);
  });
}
```

### `app/api/tasks/users/route.ts`

```ts
// FILE: app/api/tasks/users/route.ts
import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { listTaskUsers } from "@/lib/tasks/taskService";

// GET /api/tasks/users - assignee list with open-task counts (never returns passwords)
export async function GET(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return listTaskUsers(actor);
  });
}
```

### `app/api/urgent-tasks/route.ts`

```ts
// FILE: app/api/urgent-tasks/route.ts
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import UrgentTask from "@/models/UrgentTask";

async function connectMongoose() {
  if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
}

const ESCALATE_AFTER_MS = 60 * 60 * 1000; // 1 hour

// Escalation is computed on read, not by a background job - there's no
// always-on process in this Next.js/Vercel app to run a periodic timer in
// (no Express server.js, no Socket.io), and a task's "pending for over an
// hour" state is fully derivable from createdAt + status at query time
// anyway, so a stored flag+cron would only add a moving part with nothing to
// show for it.
function withEscalation(doc: any) {
  const pendingMs = Date.now() - new Date(doc.createdAt).getTime();
  return {
    ...doc,
    escalated: doc.status !== "done" && pendingMs >= ESCALATE_AFTER_MS,
    pendingMinutes: Math.floor(pendingMs / 60000),
  };
}

// GET /api/urgent-tasks?username=X - tasks currently DUE for that person to
// see (pending, or snoozed with snoozeUntil already passed) - polled by the
// global popup every ~25s (see components/UrgentTaskPopup.tsx).
// GET /api/urgent-tasks (no username) - every open (pending/snoozed) task
// system-wide, for the owner dashboard.
export async function GET(req: Request) {
  try {
    await connectMongoose();
    const { searchParams } = new URL(req.url);
    const username = searchParams.get("username");

    if (username) {
      const tasks = await UrgentTask.find({
        assignedTo: username,
        $or: [{ status: "pending" }, { status: "snoozed", snoozeUntil: { $lte: new Date() } }],
      })
        .sort({ createdAt: 1 })
        .lean();
      return NextResponse.json(tasks.map(withEscalation));
    }

    const tasks = await UrgentTask.find({ status: { $in: ["pending", "snoozed"] } })
      .sort({ createdAt: 1 })
      .lean();
    return NextResponse.json(tasks.map(withEscalation));
  } catch (error: any) {
    console.error("GET urgent-tasks error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch urgent tasks" }, { status: 500 });
  }
}

// POST /api/urgent-tasks - owner creates a new urgent task.
export async function POST(req: Request) {
  try {
    await connectMongoose();
    const { description, assignedTo, assignedBy } = await req.json();

    if (!description?.trim() || !assignedTo || !assignedBy) {
      return NextResponse.json({ error: "description, assignedTo and assignedBy are required" }, { status: 400 });
    }

    const task = await UrgentTask.create({ description: description.trim(), assignedTo, assignedBy });
    return NextResponse.json(withEscalation(task.toObject()), { status: 201 });
  } catch (error: any) {
    console.error("POST urgent-tasks error:", error);
    return NextResponse.json({ error: error.message || "Failed to create urgent task" }, { status: 500 });
  }
}
```

### `app/api/urgent-tasks/[id]/route.ts`

```ts
// FILE: app/api/urgent-tasks/[id]/route.ts
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import UrgentTask from "@/models/UrgentTask";

async function connectMongoose() {
  if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
}

const SNOOZE_MS = 10 * 60 * 1000; // 10 minutes

// PATCH /api/urgent-tasks/[id] - body: { action: "done" | "snooze" }.
// Called by the assignee from the full-screen popup - these are the only two
// ways it can ever be dismissed.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectMongoose();
    const { id } = await params;
    const { action } = await req.json();

    if (!["done", "snooze"].includes(action)) {
      return NextResponse.json({ error: "action must be 'done' or 'snooze'" }, { status: 400 });
    }

    const update =
      action === "done"
        ? { status: "done", doneAt: new Date(), snoozeUntil: null }
        : { status: "snoozed", snoozeUntil: new Date(Date.now() + SNOOZE_MS) };

    // Only a still-open task can be acted on - without this, a stale/duplicate
    // click (e.g. the popup's request landing after the task was already
    // marked done from another tab) could resurrect an already-completed task
    // back to snoozed.
    const task = await UrgentTask.findOneAndUpdate(
      { _id: id, status: { $in: ["pending", "snoozed"] } },
      update,
      { new: true }
    ).lean();
    if (!task) {
      return NextResponse.json({ error: "This task no longer exists or was already resolved" }, { status: 409 });
    }

    return NextResponse.json(task);
  } catch (error: any) {
    console.error("PATCH urgent-tasks error:", error);
    return NextResponse.json({ error: error.message || "Failed to update urgent task" }, { status: 500 });
  }
}
```

---

## 8. Frontend

| File | Kya hai | Kaun dekhta hai |
|---|---|---|
| `app/dashboard/tasks/page.tsx` | Main Tasks page: tabs, stats, filters, table, bulk actions, 30s refresh | Har logged-in user (tabs role ke hisaab se) |
| `app/dashboard/tasks/components/TaskStatsRow.tsx` | 6 stat cards | Sab |
| `app/dashboard/tasks/components/TaskTable.tsx` | Task list table + quick Start/Done/Verify buttons + row select | Sab (buttons role ke hisaab se) |
| `app/dashboard/tasks/components/TaskDrawer.tsx` | Right-side detail drawer: actions, edit, checklist, comments, activity | Jisko task dikhta ho |
| `app/dashboard/tasks/components/CreateTaskModal.tsx` | New Task form (due chips, checklist, watchers) | Sab |
| `app/dashboard/tasks/components/SearchableSelect.tsx` | Searchable dropdown (assignee picker). DEV OMS ka account statement page bhi ise use karta hai | — |
| `app/dashboard/tasks/components/taskUi.ts` | Session read, role, `api()` wrapper (`x-oms-user` header), labels, IST date format, chips | — |
| `lib/tasks/usePendingTaskCount.ts` | Navbar badge hook | Header |
| `components/GlobalTaskCreate.tsx` | Root layout mein mount; Alt+N / New Task event par modal | Sab |
| `components/UrgentTaskManagerPanel.tsx` | Urgent task assign form + open list (25s refresh) | `boss` (urgent-tasks page) |
| `components/UrgentTaskPopup.tsx` | Assignee ka full-screen urgent popup (DEV OMS mein disabled) | Assignee |
| `app/dashboard/urgent-tasks/page.tsx` | Urgent tasks owner page | Sirf `boss` |
| `components/BlockGuard.tsx` | Permission-based UI guard | — |
| `app/login/page.tsx` | Login (section 4 mein) | Public |
| `components/Header.tsx` | TASKS badge + logout (section 4 mein, sirf relevant hissa) | Sab |

Page title mapping (`lib/pageTitles.ts` mein ek line): `"/dashboard/tasks": "Tasks"`.

### `app/dashboard/tasks/page.tsx`

```tsx
// FILE: app/dashboard/tasks/page.tsx
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiCheckSquare, FiPlus, FiRefreshCw } from "react-icons/fi";
import {
  TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES, TaskDTO, TaskStatKey, TaskSummaryDTO, TaskUserDTO,
} from "@/lib/tasks/types";
import TaskStatsRow from "./components/TaskStatsRow";
import TaskTable from "./components/TaskTable";
import TaskDrawer from "./components/TaskDrawer";
import { NEW_TASK_EVENT, TASK_CREATED_EVENT } from "@/components/GlobalTaskCreate";
import { notifyTasksChanged } from "@/lib/tasks/usePendingTaskCount";
import { ApiError, CATEGORY_LABEL, TaskCtx, api, readSessionUser, roleFromSession } from "./components/taskUi";

type View = "my" | "watching" | "byme" | "team" | "all";
const POLL_MS = 30_000;
const PAGE_SIZE = 50;
const BULK_MAX = 50;

const selectCls = "p-2 border border-slate-200 rounded-xl text-xs font-bold bg-white outline-none focus:ring-2 focus:ring-[#ff9933]";

export default function TasksPage() {
  const [me, setMe] = useState<string | null>(null);
  const [sessionRole, setSessionRole] = useState<"admin" | "manager" | "staff">("staff");
  const [users, setUsers] = useState<TaskUserDTO[]>([]);
  const [view, setView] = useState<View>("my");
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<TaskSummaryDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [stat, setStat] = useState<TaskStatKey | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [firm, setFirm] = useState("");
  const [category, setCategory] = useState("");
  const [assignee, setAssignee] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [firms, setFirms] = useState<string[]>([]);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const u = readSessionUser();
    if (u) { setMe(u.username); setSessionRole(roleFromSession(u)); }
    else setLoading(false);
  }, []);

  // Prefer the server-resolved role (DB permissions) over the cached session one.
  const role = users.find((u) => u.username === me)?.role ?? sessionRole;
  const mgr = role !== "staff";

  const notify = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const ctx: TaskCtx | null = useMemo(() => (me ? { me, role, users, notify } : null), [me, role, users, notify]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Any filter change goes back to page 1 and clears the bulk selection.
  useEffect(() => { setPage(1); setSelected(new Set()); }, [view, stat, debouncedQ, status, priority, firm, category, assignee, overdueOnly]);

  const fetchAll = useCallback(async () => {
    if (!me) return;
    const sp = new URLSearchParams({ view, page: String(page), limit: String(PAGE_SIZE) });
    if (stat) sp.set("stat", stat);
    if (debouncedQ) sp.set("q", debouncedQ);
    if (status) sp.set("status", status);
    if (priority) sp.set("priority", priority);
    if (firm) sp.set("firm", firm);
    if (category) sp.set("category", category);
    if (assignee) sp.set("assignee", assignee);
    if (overdueOnly) sp.set("overdue", "true");
    try {
      const [list, sum] = await Promise.all([
        api<{ tasks: TaskDTO[]; total: number }>(`/api/tasks?${sp}`, me),
        api<TaskSummaryDTO>(`/api/tasks/summary?view=${view}`, me),
      ]);
      setTasks(list.tasks);
      setTotal(list.total);
      setSummary(sum);
      setFirms((prev) => [...new Set([...prev, ...list.tasks.map((t) => t.firm).filter(Boolean)])].sort());
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Tasks load nahi hue", "err");
    } finally {
      setLoading(false);
    }
  }, [me, view, page, stat, debouncedQ, status, priority, firm, category, assignee, overdueOnly, notify]);

  const fetchUsers = useCallback(async () => {
    if (!me) return;
    try { setUsers(await api<TaskUserDTO[]>("/api/tasks/users", me)); } catch { /* assignee list is optional */ }
  }, [me]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 30 s polling while the tab is visible; refetch immediately when it becomes visible again.
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && fetchAll();
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [fetchAll]);

  // The New Task modal lives in GlobalTaskCreate (root layout, Alt+N on every page).
  // Here, plain N (not while typing) just asks it to open; Esc closes the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.tagName === "SELECT" || el?.isContentEditable;
      if (e.key === "Escape") { if (openId) setOpenId(null); return; }
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n" && !openId) {
        e.preventDefault();
        window.dispatchEvent(new Event(NEW_TASK_EVENT));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  // Used after every user action (create/status/reassign/bulk/...), so also tell the navbar badge.
  const refreshAll = useCallback(() => { fetchAll(); fetchUsers(); notifyTasksChanged(); }, [fetchAll, fetchUsers]);

  // A task created from the global modal (possibly while on this page) refreshes the list.
  useEffect(() => {
    window.addEventListener(TASK_CREATED_EVENT, refreshAll);
    return () => window.removeEventListener(TASK_CREATED_EVENT, refreshAll);
  }, [refreshAll]);

  async function quick(task: TaskDTO, action: "start" | "done" | "verify") {
    if (!me) return;
    try {
      if (action === "verify") await api(`/api/tasks/${task._id}/verify`, me, { method: "POST", body: {} });
      else await api(`/api/tasks/${task._id}/status`, me, { method: "POST", body: { status: action === "start" ? "IN_PROGRESS" : "DONE" } });
      refreshAll();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "Action fail ho gaya", "err");
    }
  }

  async function bulk(kind: "assign" | "priority", value: string) {
    if (!me || !value) return;
    const ids = [...selected];
    if (ids.length > BULK_MAX) return notify(`Ek baar mein max ${BULK_MAX} tasks`, "err");
    let ok = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        if (kind === "assign") await api(`/api/tasks/${id}/assign`, me, { method: "POST", body: { assignee: value } });
        else await api(`/api/tasks/${id}`, me, { method: "PATCH", body: { priority: value } });
        ok++;
      } catch (e) {
        failed.push(e instanceof ApiError ? e.message : "error");
      }
    }
    notify(`${ok} updated${failed.length ? `, ${failed.length} fail (${failed[0]})` : ""}`, failed.length ? "err" : "ok");
    setSelected(new Set());
    refreshAll();
  }

  if (!me || !ctx) {
    return (
      <div className="p-8">
        {loading ? null : <p className="text-sm font-bold text-red-500">Login karke aao.</p>}
      </div>
    );
  }

  const tabs: { key: View; label: string }[] = [
    { key: "my", label: "My Tasks" },
    { key: "watching", label: "Watching" },
    { key: "byme", label: "Assigned by Me" },
    ...(mgr ? [{ key: "team" as View, label: "Team" }] : []),
    ...(role === "admin" ? [{ key: "all" as View, label: "All" }] : []),
  ];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(stat || q || status || priority || firm || category || assignee || overdueOnly);
  const clearFilters = () => { setStat(null); setQ(""); setStatus(""); setPriority(""); setFirm(""); setCategory(""); setAssignee(""); setOverdueOnly(false); };

  return (
    <div className="p-4 md:p-6 bg-[#f3f6f9] min-h-screen">
      <div className="max-w-[1500px] mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="bg-[#0a2540] text-white p-3.5 rounded-2xl"><FiCheckSquare size={22} /></div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Tasks</h1>
              <p className="text-[#ff9933] text-[10px] font-black tracking-widest uppercase">Assign · Track · Follow-up</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={refreshAll} title="Refresh" className="p-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 cursor-pointer"><FiRefreshCw size={15} /></button>
            <button type="button" onClick={() => window.dispatchEvent(new Event(NEW_TASK_EVENT))} className="flex items-center gap-2 bg-[#ff9933] hover:bg-[#f08a24] text-white text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl cursor-pointer">
              <FiPlus /> New Task <kbd className="hidden sm:inline bg-white/25 rounded px-1.5 text-[10px]">Alt+N</kbd>
            </button>
          </div>
        </div>

        <TaskStatsRow summary={summary} active={stat} onSelect={setStat} />

        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => setView(t.key)}
              className={`text-xs font-black uppercase tracking-wider rounded-full px-4 py-2 cursor-pointer ${view === t.key ? "bg-[#0a2540] text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search task no, title, buyer, order..." className={`${selectCls} w-64`} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="">All status</option>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={selectCls}>
            <option value="">All priority</option>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {/* Firm is no longer set on new tasks; only offer the filter if older tasks carry one. */}
          {(firms.length > 0 || firm) && (
            <select value={firm} onChange={(e) => setFirm(e.target.value)} className={`${selectCls} hidden xl:block`}>
              <option value="">All firms</option>
              {firms.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${selectCls} hidden xl:block`}>
            <option value="">All categories</option>
            {TASK_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL(c)}</option>)}
          </select>
          {mgr && (
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectCls}>
              <option value="">All assignees</option>
              {users.map((u) => <option key={u.username} value={u.username}>{u.username}</option>)}
            </select>
          )}
          <label className="flex items-center gap-1.5 text-xs font-bold text-red-600 cursor-pointer select-none">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
          </label>
          {hasFilters && <button type="button" onClick={clearFilters} className="text-[10px] font-black uppercase tracking-wider text-slate-500 underline cursor-pointer">Clear filters</button>}
        </div>

        {mgr && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 bg-[#0a2540] text-white rounded-2xl px-4 py-3">
            <p className="text-xs font-black uppercase tracking-wider">{selected.size} selected</p>
            <select defaultValue="" onChange={(e) => { bulk("assign", e.target.value); e.target.value = ""; }} className="p-1.5 rounded-lg text-xs font-bold text-slate-800">
              <option value="">Reassign to...</option>
              {users.filter((u) => u.assignable).map((u) => <option key={u.username} value={u.username}>{u.username} ({u.openCount})</option>)}
            </select>
            <select defaultValue="" onChange={(e) => { bulk("priority", e.target.value); e.target.value = ""; }} className="p-1.5 rounded-lg text-xs font-bold text-slate-800">
              <option value="">Set priority...</option>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="button" onClick={() => setSelected(new Set())} className="text-[10px] font-black uppercase underline cursor-pointer ml-auto">Clear</button>
          </div>
        )}

        <TaskTable
          tasks={tasks}
          ctx={ctx}
          loading={loading}
          selectable={mgr}
          selected={selected}
          onToggle={(id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
          onToggleAll={(checked) => setSelected(checked ? new Set(tasks.map((t) => t._id)) : new Set())}
          onOpen={setOpenId}
          onQuick={quick}
        />

        <div className="flex items-center justify-between text-xs font-bold text-slate-500">
          <span>{total} task{total === 1 ? "" : "s"}</span>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 cursor-pointer">Prev</button>
              <span>{page} / {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 cursor-pointer">Next</button>
            </div>
          )}
        </div>
      </div>

      {openId && <TaskDrawer taskId={openId} ctx={ctx} onClose={() => setOpenId(null)} onChanged={refreshAll} />}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl text-sm font-bold shadow-xl ${toast.kind === "err" ? "bg-red-600 text-white" : "bg-[#0a2540] text-white"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
```

### `app/dashboard/tasks/components/taskUi.ts`

```ts
// FILE: app/dashboard/tasks/components/taskUi.ts
import type { TaskPriority, TaskRole, TaskStatus, TaskUserDTO } from "@/lib/tasks/types";

/* ---------------------------------------------------------------- session */

export interface SessionUser {
  username: string;
  permissions?: Record<string, boolean>;
}

export function readSessionUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem("oms_user");
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u?.username ? u : null;
  } catch {
    return null;
  }
}

/** Mirrors lib/tasks/permissions.ts getTaskRole (+ the hardcoded super-admins) for first paint. */
export function roleFromSession(u: SessionUser | null): TaskRole {
  if (!u) return "staff";
  if (["admin", "chintan", "hitesh"].includes(u.username.toLowerCase()) || u.permissions?.boss) return "admin";
  return u.permissions?.taskManager ? "manager" : "staff";
}

export interface TaskCtx {
  me: string;
  role: TaskRole;
  users: TaskUserDTO[];
  notify: (msg: string, kind?: "ok" | "err") => void;
}

/* -------------------------------------------------------------------- api */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, me: string, init: { method?: string; body?: any } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method || "GET",
    headers: { "Content-Type": "application/json", "x-oms-user": me },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error || "Request fail ho gayi");
  return data as T;
}

/* ---------------------------------------------------------------- display */

export const STATUS_META: Record<TaskStatus, { label: string; cls: string }> = {
  OPEN: { label: "Open", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  IN_PROGRESS: { label: "In Progress", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  WAITING: { label: "Waiting", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  DONE: { label: "Done (verify)", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  CLOSED: { label: "Closed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Cancelled", cls: "bg-rose-50 text-rose-400 border-rose-200 line-through" },
};

export const PRIORITY_META: Record<TaskPriority, { label: string; cls: string }> = {
  LOW: { label: "Low", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  NORMAL: { label: "Normal", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  HIGH: { label: "High", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  URGENT: { label: "Urgent", cls: "bg-red-50 text-red-700 border-red-300" },
};

export const CATEGORY_LABEL = (c: string) => c.replace(/_/g, " ").toLowerCase();

const IST = "Asia/Kolkata";

/** dd-MMM-yyyy hh:mm a, in IST. */
export function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "-";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "-";
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" })
    .format(date).replace(/ /g, "-");
  const time = new Intl.DateTimeFormat("en-US", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true }).format(date);
  return `${day} ${time}`;
}

const istDayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d); // YYYY-MM-DD
const istTime = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true }).format(d);

export const ACTIVE = ["OPEN", "IN_PROGRESS", "WAITING"];
export const isOverdue = (t: { status: string; dueAt: string }) => ACTIVE.includes(t.status) && new Date(t.dueAt).getTime() < Date.now();

/** "Today 5:00 PM", "Tomorrow 10:00 AM", "2 days overdue", "3h overdue". */
export function relativeDue(t: { status: string; dueAt: string }): { text: string; overdue: boolean } {
  const due = new Date(t.dueAt);
  const now = new Date();
  if (isOverdue(t)) {
    const mins = Math.floor((now.getTime() - due.getTime()) / 60000);
    if (mins < 60) return { text: `${Math.max(mins, 1)}m overdue`, overdue: true };
    if (mins < 24 * 60) return { text: `${Math.floor(mins / 60)}h overdue`, overdue: true };
    const days = Math.floor(mins / (24 * 60));
    return { text: `${days} day${days > 1 ? "s" : ""} overdue`, overdue: true };
  }
  const dayDiff = Math.round((Date.parse(istDayKey(due)) - Date.parse(istDayKey(now))) / 86400000);
  if (dayDiff === 0) return { text: `Today ${istTime(due)}`, overdue: false };
  if (dayDiff === 1) return { text: `Tomorrow ${istTime(due)}`, overdue: false };
  return { text: fmtDateTime(due), overdue: false };
}

/* ------------------------------------------------------------ date chips */

const pad = (n: number) => String(n).padStart(2, "0");

/** Value for <input type="datetime-local"> (browser-local time; OMS users are in IST). */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const atHour = (d: Date, h: number, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const DUE_CHIPS: { label: string; get: () => Date }[] = [
  { label: "Today EOD", get: () => { const d = atHour(new Date(), 19); return d.getTime() > Date.now() ? d : atHour(new Date(), 23, 59); } },
  { label: "Tomorrow", get: () => atHour(addDays(new Date(), 1), 18) },
  { label: "3 days", get: () => atHour(addDays(new Date(), 3), 18) },
  { label: "Next week", get: () => atHour(addDays(new Date(), 7), 18) },
];

export const FOLLOWUP_CHIPS: { label: string; get: () => Date }[] = [
  { label: "Tomorrow", get: () => atHour(addDays(new Date(), 1), 10) },
  { label: "2 days", get: () => atHour(addDays(new Date(), 2), 10) },
  {
    label: "Next Mon",
    get: () => { const now = new Date(); const diff = ((8 - now.getDay()) % 7) || 7; return atHour(addDays(now, diff), 10); },
  },
  { label: "1 week", get: () => atHour(addDays(new Date(), 7), 10) },
];
```

### `app/dashboard/tasks/components/TaskStatsRow.tsx`

```tsx
// FILE: app/dashboard/tasks/components/TaskStatsRow.tsx
"use client";
import type { TaskStatKey, TaskSummaryDTO } from "@/lib/tasks/types";

const CARDS: { key: TaskStatKey; label: string; cls: string; active: string }[] = [
  { key: "open", label: "Open", cls: "text-[#0a2540]", active: "ring-[#0a2540]" },
  { key: "dueToday", label: "Due Today", cls: "text-[#ea580c]", active: "ring-[#ea580c]" },
  { key: "overdue", label: "Overdue", cls: "text-red-600", active: "ring-red-600" },
  { key: "waiting", label: "Waiting", cls: "text-amber-600", active: "ring-amber-500" },
  { key: "followUpsToday", label: "Follow-ups Today", cls: "text-sky-700", active: "ring-sky-600" },
  { key: "toVerify", label: "To Verify", cls: "text-violet-700", active: "ring-violet-600" },
];

interface Props {
  summary: TaskSummaryDTO | null;
  active: TaskStatKey | null;
  onSelect: (key: TaskStatKey | null) => void;
}

export default function TaskStatsRow({ summary, active, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {CARDS.map((c) => {
        const isActive = active === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onSelect(isActive ? null : c.key)}
            className={`bg-white rounded-2xl border border-slate-200 p-4 text-left transition-all hover:shadow-md cursor-pointer ${isActive ? `ring-2 ${c.active}` : ""}`}
          >
            <p className={`text-3xl font-black leading-none ${c.cls}`}>{summary ? summary[c.key] : "-"}</p>
            <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-500">{c.label}</p>
          </button>
        );
      })}
    </div>
  );
}
```

### `app/dashboard/tasks/components/TaskTable.tsx`

```tsx
// FILE: app/dashboard/tasks/components/TaskTable.tsx
"use client";
import type { TaskDTO } from "@/lib/tasks/types";
import { CATEGORY_LABEL, PRIORITY_META, STATUS_META, TaskCtx, fmtDateTime, relativeDue } from "./taskUi";

interface Props {
  tasks: TaskDTO[];
  ctx: TaskCtx;
  loading: boolean;
  selectable: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onOpen: (id: string) => void;
  onQuick: (task: TaskDTO, action: "start" | "done" | "verify") => void;
}

export default function TaskTable({ tasks, ctx, loading, selectable, selected, onToggle, onToggleAll, onOpen, onQuick }: Props) {
  const mgr = ctx.role !== "staff";
  const allChecked = tasks.length > 0 && tasks.every((t) => selected.has(t._id));
  // Firm is optional (no longer captured on new tasks) - only show the column when some row has one.
  const showFirm = tasks.some((t) => t.firm);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto xl:overflow-visible">
        <table className="w-full text-sm table-fixed xl:table-auto">
          <thead className="bg-[#0a2540] text-white sticky top-0 z-10">
            <tr className="text-[10px] font-black uppercase tracking-widest text-left">
              {selectable && (
                <th className="w-9 px-3 py-3">
                  <input type="checkbox" checked={allChecked} onChange={(e) => onToggleAll(e.target.checked)} className="cursor-pointer" />
                </th>
              )}
              <th className="px-3 py-3 w-32">Task No</th>
              <th className="px-3 py-3">Title</th>
              {showFirm && <th className="px-3 py-3 hidden xl:table-cell">Firm</th>}
              <th className="px-3 py-3 w-28">Assignee</th>
              <th className="px-3 py-3 w-24">Priority</th>
              <th className="px-3 py-3 w-36">Due</th>
              <th className="px-3 py-3 w-28">Status</th>
              <th className="px-3 py-3 w-28 hidden lg:table-cell">Next F/U</th>
              <th className="px-3 py-3 w-24 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const due = relativeDue(t);
              const links = [t.links?.gemOrderNo && `Order ${t.links.gemOrderNo}`, t.links?.bidNo && `Bid ${t.links.bidNo}`, t.links?.billNo && `Bill ${t.links.billNo}`, t.links?.buyerName]
                .filter(Boolean) as string[];
              const own = t.assignee === ctx.me;
              const canAct = mgr || own;
              const quick =
                t.status === "OPEN" && canAct ? "start"
                : (t.status === "IN_PROGRESS" || t.status === "WAITING") && canAct ? "done"
                : t.status === "DONE" && mgr ? "verify"
                : null;
              return (
                <tr
                  key={t._id}
                  onClick={() => onOpen(t._id)}
                  className={`border-t border-slate-100 hover:bg-slate-50 cursor-pointer border-l-4 ${due.overdue ? "border-l-red-500 bg-red-50/30" : "border-l-transparent"}`}
                >
                  {selectable && (
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(t._id)} onChange={() => onToggle(t._id)} className="cursor-pointer" />
                    </td>
                  )}
                  <td className="px-3 py-3 font-mono text-[11px] font-bold text-slate-500">{t.taskNo}</td>
                  <td className="px-3 py-3 min-w-0">
                    <p className="font-bold text-[#0a2540] truncate">{t.title}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {t.category !== "GENERAL" && (
                        <span className="hidden xl:inline text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{CATEGORY_LABEL(t.category)}</span>
                      )}
                      {links.map((l) => (
                        <span key={l} className="text-[9px] font-bold bg-sky-50 text-sky-700 border border-sky-100 rounded px-1.5 py-0.5 truncate max-w-[10rem]">{l}</span>
                      ))}
                    </div>
                  </td>
                  {showFirm && <td className="px-3 py-3 hidden xl:table-cell text-xs text-slate-600 truncate">{t.firm}</td>}
                  <td className="px-3 py-3 text-xs font-bold text-slate-700 truncate">{t.assignee}</td>
                  <td className="px-3 py-3">
                    <span className={`text-[10px] font-black uppercase border rounded-full px-2 py-0.5 ${PRIORITY_META[t.priority].cls}`}>{PRIORITY_META[t.priority].label}</span>
                  </td>
                  <td className={`px-3 py-3 text-xs font-bold ${due.overdue ? "text-red-600" : "text-slate-600"}`}>{due.text}</td>
                  <td className="px-3 py-3">
                    <span className={`text-[10px] font-black uppercase border rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS_META[t.status].cls}`}>{STATUS_META[t.status].label}</span>
                  </td>
                  <td className="px-3 py-3 hidden lg:table-cell text-[11px] text-slate-500">{t.nextFollowUpAt ? fmtDateTime(t.nextFollowUpAt) : "-"}</td>
                  <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {quick && (
                      <button
                        type="button"
                        onClick={() => onQuick(t, quick)}
                        className="text-[10px] font-black uppercase tracking-wider bg-[#ff9933]/15 hover:bg-[#ff9933]/30 text-[#c2410c] border border-[#ff9933]/40 rounded-full px-3 py-1 cursor-pointer"
                      >
                        {quick === "start" ? "Start" : quick === "done" ? "Done" : "Verify"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!tasks.length && (
        <p className="p-10 text-center text-xs font-black uppercase tracking-widest text-slate-400">
          {loading ? "Loading..." : "Koi task nahi mila"}
        </p>
      )}
    </div>
  );
}
```

### `app/dashboard/tasks/components/TaskDrawer.tsx`

```tsx
// FILE: app/dashboard/tasks/components/TaskDrawer.tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { FiX } from "react-icons/fi";
import { TASK_PRIORITIES, WAITING_ON, ChecklistItemDTO, TaskActivityDTO, TaskDTO } from "@/lib/tasks/types";
import {
  ApiError, FOLLOWUP_CHIPS, PRIORITY_META, STATUS_META, TaskCtx, api, fmtDateTime, relativeDue, toLocalInput,
} from "./taskUi";

interface Props {
  taskId: string;
  ctx: TaskCtx;
  onClose: () => void;
  /** Called after any successful mutation so the list + stats refetch. */
  onChanged: () => void;
}

type Panel = null | "waiting" | "reject" | "reopen" | "cancel";
type ActTab = "all" | "comments" | "system";

const btn = "px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider cursor-pointer disabled:opacity-50";
const field = "w-full p-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#ff9933]";

export default function TaskDrawer({ taskId, ctx, onClose, onChanged }: Props) {
  const [task, setTask] = useState<TaskDTO | null>(null);
  const [activities, setActivities] = useState<TaskActivityDTO[]>([]);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState("");
  const [waitingOn, setWaitingOn] = useState<string>("BUYER");
  const [nextFollowUp, setNextFollowUp] = useState("");
  const [comment, setComment] = useState("");
  const [tab, setTab] = useState<ActTab>("all");
  const [title, setTitle] = useState("");

  const mgr = ctx.role !== "staff";
  const load = useCallback(async () => {
    try {
      const res = await api<{ task: TaskDTO; activities: TaskActivityDTO[] }>(`/api/tasks/${taskId}`, ctx.me);
      setTask(res.task);
      setTitle(res.task.title);
      setActivities(res.activities);
      setError("");
      setConflict(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Task load nahi hua");
    }
  }, [taskId, ctx.me]);

  useEffect(() => { setTask(null); setPanel(null); load(); }, [load]);

  /** Run a mutation, refresh drawer + list, surface 409 with a refresh option. */
  async function run(fn: () => Promise<any>, okMsg?: string) {
    setBusy(true);
    try {
      await fn();
      setPanel(null);
      setReason("");
      await load();
      onChanged();
      if (okMsg) ctx.notify(okMsg);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      ctx.notify(e instanceof ApiError ? e.message : "Action fail ho gaya", "err");
    } finally {
      setBusy(false);
    }
  }

  if (!task) {
    return (
      <Shell onClose={onClose}>
        <p className="p-10 text-center text-xs font-black uppercase tracking-widest text-slate-400">{error || "Loading..."}</p>
      </Shell>
    );
  }

  const own = task.assignee === ctx.me;
  const canAct = mgr || own;
  const live = task.status !== "CLOSED" && task.status !== "CANCELLED";
  const due = relativeDue(task);
  const post = (path: string, body: any = {}) => api(`/api/tasks/${task._id}/${path}`, ctx.me, { method: "POST", body });
  const patch = (body: any) => api(`/api/tasks/${task._id}`, ctx.me, { method: "PATCH", body: { ...body, expectedUpdatedAt: task.updatedAt } });
  const setStatus = (status: string, extra: any = {}) => run(() => post("status", { status, ...extra }));

  const checklist = task.checklist || [];
  const doneCount = checklist.filter((c) => c.done).length;

  async function toggleItem(item: ChecklistItemDTO) {
    const next = checklist.map((c) => ({ _id: c._id, text: c.text, done: c._id === item._id ? !c.done : c.done }));
    await run(() => patch({ checklist: next }));
    if (next.length && next.every((c) => c.done) && task!.status !== "DONE") {
      ctx.notify("Checklist complete - Mark Done karo?");
    }
  }

  const filteredActs = activities.filter((a) =>
    tab === "all" ? true : tab === "comments" ? a.type === "COMMENT" : a.type !== "COMMENT"
  );

  return (
    <Shell onClose={onClose}>
      {/* Header */}
      <div className="p-5 border-b border-slate-100 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] font-bold text-slate-400">{task.taskNo}</p>
            {mgr && live ? (
              <input
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title.trim() && title !== task.title && run(() => patch({ title }))}
                className="w-full text-lg font-black text-[#0a2540] bg-transparent border-b border-transparent hover:border-slate-200 focus:border-[#ff9933] outline-none"
              />
            ) : (
              <h2 className="text-lg font-black text-[#0a2540]">{task.title}</h2>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 cursor-pointer shrink-0"><FiX /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[10px] font-black uppercase border rounded-full px-2.5 py-0.5 ${STATUS_META[task.status].cls}`}>{STATUS_META[task.status].label}</span>
          <span className={`text-[10px] font-black uppercase border rounded-full px-2.5 py-0.5 ${PRIORITY_META[task.priority].cls}`}>{PRIORITY_META[task.priority].label}</span>
          <span className={`text-xs font-bold ${due.overdue ? "text-red-600" : "text-slate-500"}`}>{due.text}</span>
          {due.overdue && <span className="text-[10px] font-black uppercase bg-red-600 text-white rounded-full px-2 py-0.5">Overdue</span>}
        </div>
      </div>

      {conflict && (
        <div className="m-5 mb-0 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800 flex items-center justify-between gap-3">
          Task kisi aur ne update kiya hai, refresh karo
          <button type="button" onClick={load} className="bg-amber-500 text-white rounded-lg px-3 py-1 font-black uppercase cursor-pointer">Refresh</button>
        </div>
      )}

      {/* Actions */}
      <div className="p-5 space-y-3 border-b border-slate-100">
        <div className="flex flex-wrap gap-2">
          {canAct && task.status === "OPEN" && <button disabled={busy} onClick={() => setStatus("IN_PROGRESS")} className={`${btn} bg-blue-600 text-white`}>Start</button>}
          {canAct && task.status === "WAITING" && <button disabled={busy} onClick={() => setStatus("IN_PROGRESS")} className={`${btn} bg-blue-600 text-white`}>Resume</button>}
          {canAct && (task.status === "OPEN" || task.status === "IN_PROGRESS") && (
            <button disabled={busy} onClick={() => setPanel(panel === "waiting" ? null : "waiting")} className={`${btn} bg-amber-100 text-amber-800`}>Mark Waiting</button>
          )}
          {canAct && (task.status === "OPEN" || task.status === "IN_PROGRESS" || task.status === "WAITING") && (
            <button disabled={busy} onClick={() => setStatus("DONE")} className={`${btn} bg-emerald-600 text-white`}>Mark Done</button>
          )}
          {mgr && task.status === "DONE" && <button disabled={busy} onClick={() => run(() => post("verify"), "Verify karke close kiya")} className={`${btn} bg-emerald-600 text-white`}>Verify & Close</button>}
          {mgr && task.status === "DONE" && <button disabled={busy} onClick={() => setPanel(panel === "reject" ? null : "reject")} className={`${btn} bg-red-100 text-red-700`}>Reject</button>}
          {mgr && task.status === "CLOSED" && <button disabled={busy} onClick={() => setPanel(panel === "reopen" ? null : "reopen")} className={`${btn} bg-violet-100 text-violet-700`}>Reopen</button>}
          {mgr && (task.status === "OPEN" || task.status === "IN_PROGRESS" || task.status === "WAITING") && <button disabled={busy} onClick={() => setPanel(panel === "cancel" ? null : "cancel")} className={`${btn} bg-slate-100 text-slate-600`}>Cancel</button>}
        </div>

        {panel === "waiting" && (
          <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200 space-y-2">
            <select value={waitingOn} onChange={(e) => setWaitingOn(e.target.value)} className={field}>
              {WAITING_ON.map((w) => <option key={w} value={w}>Waiting on: {w}</option>)}
            </select>
            <input type="datetime-local" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} className={field} />
            <div className="flex flex-wrap gap-2">
              {FOLLOWUP_CHIPS.map((c) => (
                <button key={c.label} type="button" onClick={() => setNextFollowUp(toLocalInput(c.get()))}
                  className="text-[10px] font-black uppercase bg-white border border-amber-200 hover:bg-amber-100 rounded-full px-3 py-1 cursor-pointer">{c.label}</button>
              ))}
            </div>
            <button
              disabled={busy}
              onClick={() => (nextFollowUp ? setStatus("WAITING", { waitingOn, nextFollowUpAt: new Date(nextFollowUp).toISOString() }) : ctx.notify("Next follow-up date zaroori hai", "err"))}
              className={`${btn} bg-amber-500 text-white`}
            >Set Waiting</button>
          </div>
        )}
        {(panel === "reject" || panel === "reopen" || panel === "cancel") && (
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (zaroori)" className={field} />
            <button
              disabled={busy}
              onClick={() => {
                if (!reason.trim()) return ctx.notify("Reason likhna zaroori hai", "err");
                if (panel === "cancel") return setStatus("CANCELLED", { reason });
                return run(() => post(panel, { reason }), panel === "reject" ? "Task reject hua" : "Task reopen hua");
              }}
              className={`${btn} bg-[#0a2540] text-white`}
            >Confirm {panel}</button>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="p-5 space-y-4 border-b border-slate-100">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Info label="Assignee">
            {mgr && live ? (
              <select
                value={task.assignee}
                disabled={busy}
                onChange={(e) => e.target.value !== task.assignee && run(() => post("assign", { assignee: e.target.value }), "Reassign ho gaya")}
                className={field}
              >
                {!ctx.users.some((u) => u.username === task.assignee) && <option value={task.assignee}>{task.assignee}</option>}
                {ctx.users.filter((u) => u.assignable || u.username === task.assignee).map((u) => (
                  <option key={u.username} value={u.username}>{u.username} ({u.openCount} open)</option>
                ))}
              </select>
            ) : <b>{task.assignee}</b>}
          </Info>
          <Info label="Assigned by"><b>{task.assignedBy}</b></Info>
          <Info label="Due">
            {mgr && live ? (
              <input
                type="datetime-local"
                defaultValue={toLocalInput(new Date(task.dueAt))}
                key={task.updatedAt}
                onBlur={(e) => e.target.value && new Date(e.target.value).getTime() !== new Date(task.dueAt).getTime() && run(() => patch({ dueAt: new Date(e.target.value).toISOString() }))}
                className={field}
              />
            ) : <b>{fmtDateTime(task.dueAt)}</b>}
          </Info>
          <Info label="Priority">
            {mgr && live ? (
              <select value={task.priority} disabled={busy} onChange={(e) => run(() => patch({ priority: e.target.value }))} className={field}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : <b>{task.priority}</b>}
          </Info>
          {task.firm && <Info label="Firm"><b>{task.firm}</b></Info>}
          <Info label="Verification"><b>{task.requiresVerification ? "Required" : "Not required"}</b></Info>
          {task.status === "WAITING" && (
            <>
              <Info label="Waiting on"><b>{task.waitingOn}</b></Info>
              <Info label="Next follow-up"><b>{fmtDateTime(task.nextFollowUpAt)}</b></Info>
            </>
          )}
          {task.completedAt && <Info label="Completed"><b>{fmtDateTime(task.completedAt)}</b></Info>}
          {task.closedAt && <Info label="Closed"><b>{fmtDateTime(task.closedAt)} by {task.closedBy}</b></Info>}
        </div>

        {(task.watchers?.length > 0) && (
          <p className="text-xs text-slate-500"><b className="uppercase tracking-widest text-[10px]">Watchers:</b> {task.watchers.join(", ")}</p>
        )}

        {Object.values(task.links || {}).some(Boolean) && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(task.links).filter(([, v]) => v).map(([k, v]) => (
              <span key={k} className="text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-100 rounded-full px-2.5 py-1">{k.replace(/([A-Z])/g, " $1").toLowerCase()}: {v}</span>
            ))}
          </div>
        )}

        {task.description && <p className="text-sm text-slate-700 whitespace-pre-wrap">{task.description}</p>}

        {checklist.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Checklist</p>
              <p className="text-[10px] font-bold text-slate-500">{doneCount}/{checklist.length}</p>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
            </div>
            <div className="space-y-1">
              {checklist.map((c) => (
                <label key={c._id} className={`flex items-center gap-2 text-sm ${canAct && live ? "cursor-pointer" : "opacity-70"}`}>
                  <input type="checkbox" checked={c.done} disabled={busy || !canAct || !live} onChange={() => toggleItem(c)} />
                  <span className={c.done ? "line-through text-slate-400" : "text-slate-700"}>{c.text}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Activity */}
      <div className="p-5 space-y-3">
        <div className="flex gap-1.5">
          {(["all", "comments", "system"] as ActTab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`text-[10px] font-black uppercase tracking-wider rounded-full px-3 py-1 cursor-pointer ${tab === t ? "bg-[#0a2540] text-white" : "bg-slate-100 text-slate-600"}`}>{t}</button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!comment.trim()) return;
            run(() => post("comments", { text: comment }).then(() => setComment("")));
          }}
          className="flex gap-2"
        >
          <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="Comment likho... (@username se mention)" className={field} />
          <button disabled={busy || !comment.trim()} className={`${btn} bg-[#ff9933] text-white shrink-0`}>Post</button>
        </form>

        <ul className="space-y-2">
          {filteredActs.map((a) => (
            <li key={a._id} className={`text-xs rounded-xl p-3 border ${a.type === "COMMENT" ? "bg-sky-50/50 border-sky-100" : "bg-slate-50 border-slate-100"}`}>
              <div className="flex justify-between gap-2 text-[10px] font-bold text-slate-400">
                <span className="uppercase tracking-wider">{a.by || "system"} · {a.type.replace(/_/g, " ")}</span>
                <span>{fmtDateTime(a.createdAt)}</span>
              </div>
              {a.text && <p className="mt-1 text-slate-700 whitespace-pre-wrap">{a.text}</p>}
            </li>
          ))}
          {!filteredActs.length && <li className="text-xs text-slate-400 font-bold">Kuch nahi</li>}
        </ul>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl">{children}</aside>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">{label}</p>
      <div className="text-slate-800">{children}</div>
    </div>
  );
}
```

### `app/dashboard/tasks/components/CreateTaskModal.tsx`

```tsx
// FILE: app/dashboard/tasks/components/CreateTaskModal.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { FiX } from "react-icons/fi";
import { TASK_CATEGORIES, TASK_PRIORITIES } from "@/lib/tasks/types";
import { ApiError, CATEGORY_LABEL, DUE_CHIPS, TaskCtx, api, toLocalInput } from "./taskUi";
import SearchableSelect from "./SearchableSelect";

interface Props {
  ctx: TaskCtx;
  onClose: () => void;
  onCreated: () => void;
}

const inputCls = "w-full p-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#ff9933]";
const labelCls = "block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1";

export default function CreateTaskModal({ ctx, onClose, onCreated }: Props) {
  const staff = ctx.role === "staff";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState(ctx.me);
  const [priority, setPriority] = useState("NORMAL");
  const [dueAt, setDueAt] = useState("");
  const [category, setCategory] = useState("GENERAL");
  const [watchers, setWatchers] = useState<string[]>([]);
  const [checklist, setChecklist] = useState("");
  const [requiresVerification, setRequiresVerification] = useState(false);
  const [verTouched, setVerTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => titleRef.current?.focus(), []);

  // Self-tasks default to no verification; tasks for others default to verification (spec 6.4).
  useEffect(() => {
    if (!verTouched) setRequiresVerification(assignee !== ctx.me);
  }, [assignee, ctx.me, verTouched]);

  const assignable = ctx.users.filter((u) => u.assignable);
  const assigneeOptions = assignable.map((u) => ({ value: u.username, label: `${u.username} (${u.openCount} open)`, searchText: u.username }));
  const categoryOptions = TASK_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL(c) }));
  // The assignee is already on the task, so they are not offered as a watcher.
  const watcherOptions = ctx.users.filter((u) => u.username !== assignee).map((u) => ({ value: u.username, label: u.username }));

  function changeAssignee(next: string) {
    setAssignee(next);
    setWatchers((w) => w.filter((x) => x !== next));
  }

  async function submit() {
    if (saving) return;
    setError("");
    if (!title.trim()) return setError("Title zaroori hai");
    if (!dueAt) return setError("Due date zaroori hai");
    setSaving(true);
    try {
      const res = await api<{ warning?: string }>("/api/tasks", ctx.me, {
        method: "POST",
        body: {
          title, description, assignee, priority, category, watchers, requiresVerification,
          dueAt: new Date(dueAt).toISOString(),
          checklist: checklist.split("\n").map((s) => s.trim()).filter(Boolean),
        },
      });
      ctx.notify(res.warning ? `Task bana. ${res.warning}` : "Task ban gaya");
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Task nahi bana");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl my-4"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-black uppercase tracking-wider text-[#0a2540]">New Task</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 cursor-pointer"><FiX /></button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>}

          <div>
            <label className={labelCls}>Title *</label>
            <input ref={titleRef} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Kya kaam karna hai?" />
          </div>
          {/* Two columns on md+: text content on the left, assignment/schedule on the right. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Description</label>
              <textarea value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} rows={4} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Checklist (ek line = ek item)</label>
              <textarea value={checklist} onChange={(e) => setChecklist(e.target.value)} rows={4} className={inputCls} />
            </div>
          </div>

          <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Assignee *</label>
              {staff ? (
                <input value={ctx.me} disabled className={`${inputCls} bg-slate-50 text-slate-500`} />
              ) : (
                <SearchableSelect value={assignee} onChange={changeAssignee} options={assigneeOptions} placeholder="Select assignee" />
              )}
            </div>
            <div>
              <label className={labelCls}>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Due date & time *</label>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={inputCls} />
            <div className="flex flex-wrap gap-2 mt-2">
              {DUE_CHIPS.map((c) => (
                <button key={c.label} type="button" onClick={() => setDueAt(toLocalInput(c.get()))}
                  className="text-[10px] font-black uppercase tracking-wider bg-slate-100 hover:bg-[#ff9933]/20 rounded-full px-3 py-1 cursor-pointer">{c.label}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Category</label>
              <SearchableSelect value={category} onChange={setCategory} options={categoryOptions} placeholder="Select category" />
            </div>
            <div>
              <label className={labelCls}>Watchers (CC)</label>
              <SearchableSelect multiple value={watchers} onChange={setWatchers} options={watcherOptions} placeholder="+ Add watcher" />
            </div>
          </div>
          </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
            <input type="checkbox" checked={requiresVerification} onChange={(e) => { setRequiresVerification(e.target.checked); setVerTouched(true); }} />
            Done ke baad manager/admin verify kare (Requires verification)
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 font-bold">Ctrl+Enter save · Esc close</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl bg-slate-100 text-xs font-black uppercase cursor-pointer">Cancel</button>
            <button type="button" onClick={submit} disabled={saving} className="px-6 py-2.5 rounded-xl bg-[#0a2540] text-white text-xs font-black uppercase tracking-wider disabled:opacity-50 cursor-pointer">
              {saving ? "Saving..." : "Create Task"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### `app/dashboard/tasks/components/SearchableSelect.tsx`

```tsx
// FILE: app/dashboard/tasks/components/SearchableSelect.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { FiCheck, FiChevronDown, FiX } from "react-icons/fi";

export interface SelectOption {
  value: string;
  label: string;
  /** Extra text matched by the search box (defaults to the label). */
  searchText?: string;
}

interface BaseProps {
  options: SelectOption[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
}
interface SingleProps extends BaseProps {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
}
interface MultiProps extends BaseProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
}

const triggerCls =
  "w-full p-2.5 border border-slate-200 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-[#ff9933] flex items-center justify-between gap-2 text-left cursor-pointer";

/**
 * Lightweight searchable dropdown (single or multi). While open it owns Escape
 * (closes only the dropdown, not the surrounding modal); every other key,
 * including Ctrl+Enter, bubbles so the modal's save shortcut keeps working.
 */
export default function SearchableSelect(props: SingleProps | MultiProps) {
  const { options, placeholder = "Select...", emptyText = "Koi result nahi mila", className = "" } = props;
  const selected: string[] = props.multiple ? props.value : props.value ? [props.value] : [];

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const mouseDown = useRef(false);
  const skipFocusOpen = useRef(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => (o.searchText ?? o.label).toLowerCase().includes(q));
  }, [options, query]);

  const openDropdown = () => {
    // Flip upward when there is not enough room below (small screens / bottom of modal).
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setOpenUp(below < 280 && rect.top > below);
    }
    setQuery("");
    setActive(0);
    setOpen(true);
  };
  const closeDropdown = (refocus = true) => {
    setOpen(false);
    if (refocus) {
      skipFocusOpen.current = true; // programmatic refocus must not re-open the list
      triggerRef.current?.focus();
    }
  };

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(opt: SelectOption) {
    if (props.multiple) {
      if (!selected.includes(opt.value)) props.onChange([...selected, opt.value]);
      // stay open so several users can be added quickly
      inputRef.current?.focus();
    } else {
      props.onChange(opt.value);
      closeDropdown();
    }
  }

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation(); // dropdown only - keep the modal open
      e.preventDefault();
      closeDropdown();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (filtered[active]) choose(filtered[active]);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {props.multiple && selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((v) => (
            <span key={v} className="text-xs font-bold bg-sky-50 text-sky-700 border border-sky-100 rounded-full pl-2.5 pr-1 py-0.5 flex items-center gap-1">
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => props.onChange(selected.filter((x) => x !== v))}
                className="p-0.5 rounded-full hover:bg-sky-100 cursor-pointer"
              >
                <FiX size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        className={triggerCls}
        aria-haspopup="listbox"
        aria-expanded={open}
        onMouseDown={() => { mouseDown.current = true; }}
        onFocus={() => {
          if (skipFocusOpen.current) { skipFocusOpen.current = false; return; }
          if (!mouseDown.current && !open) openDropdown();
        }}
        onClick={() => { mouseDown.current = false; if (open) closeDropdown(false); else openDropdown(); }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); openDropdown(); }
        }}
      >
        <span className={`truncate ${!props.multiple && selected[0] ? "text-slate-800" : "text-slate-400"}`}>
          {!props.multiple && selected[0] ? labelOf(selected[0]) : placeholder}
        </span>
        <FiChevronDown className="shrink-0 text-slate-400" />
      </button>

      {open && (
        <div
          className={`absolute z-50 left-0 w-full max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-xl shadow-xl ${openUp ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onSearchKey}
            placeholder="Search..."
            className="w-full p-2.5 border-b border-slate-100 rounded-t-xl text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-[#ff9933]"
          />
          <ul ref={listRef} role="listbox" className="max-h-56 overflow-y-auto py-1">
            {filtered.map((o, i) => {
              const isSel = selected.includes(o.value);
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()} // keep focus in the search box
                  onClick={() => choose(o)}
                  className={`px-3 py-2 text-sm flex items-center justify-between gap-2 cursor-pointer ${i === active ? "bg-[#ff9933]/15" : ""} ${isSel ? "font-bold text-[#0a2540]" : "text-slate-700"}`}
                >
                  <span className="truncate">{o.label}</span>
                  {isSel && <FiCheck className="shrink-0 text-emerald-600" />}
                </li>
              );
            })}
            {!filtered.length && <li className="px-3 py-3 text-xs font-bold text-slate-400">{emptyText}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
```

### `lib/tasks/usePendingTaskCount.ts`

```ts
// FILE: lib/tasks/usePendingTaskCount.ts
"use client";
import { useEffect, useRef, useState } from "react";

/** Fire this after any task create / status change / reassign / delete so the navbar badge refreshes instantly. */
export const TASKS_CHANGED_EVENT = "tasks:changed";
export const notifyTasksChanged = () => window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));

const POLL_MS = 60_000;
const PULSE_MS = 1500;

/**
 * Pending-task count for the logged-in user. Refreshes on mount, every 60 s
 * (visible tab only), on tab focus, and on the "tasks:changed" window event.
 * Returns count 0 (badge hidden) when logged out or when the API fails.
 */
export function usePendingTaskCount(username: string | null) {
  const [count, setCount] = useState(0);
  const [pulse, setPulse] = useState(false);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    if (!username) { prev.current = null; return; }
    let cancelled = false;
    let pulseTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      // Logged out in another tab/after logout -> stop quietly.
      if (!localStorage.getItem("oms_user")) { if (!cancelled) setCount(0); return; }
      try {
        const res = await fetch("/api/tasks/pending-count", { headers: { "x-oms-user": username }, cache: "no-store" });
        if (!res.ok) throw new Error(`pending-count ${res.status}`);
        const { count: next } = await res.json();
        if (cancelled || typeof next !== "number") return;
        if (prev.current !== null && next > prev.current) {
          setPulse(true);
          if (pulseTimer) clearTimeout(pulseTimer);
          pulseTimer = setTimeout(() => setPulse(false), PULSE_MS);
        }
        prev.current = next;
        setCount(next);
      } catch (e) {
        console.warn("Pending task count failed:", e); // badge just stays hidden
        if (!cancelled) setCount(0);
      }
    };

    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    load();
    const id = setInterval(onVisible, POLL_MS);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(TASKS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (pulseTimer) clearTimeout(pulseTimer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(TASKS_CHANGED_EVENT, load);
    };
  }, [username]);

  return { count: username ? count : 0, pulse };
}
```

### `components/GlobalTaskCreate.tsx`

```tsx
// FILE: components/GlobalTaskCreate.tsx
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TaskUserDTO } from "@/lib/tasks/types";
import { notifyTasksChanged } from "@/lib/tasks/usePendingTaskCount";
import CreateTaskModal from "@/app/dashboard/tasks/components/CreateTaskModal";
import { TaskCtx, api, readSessionUser, roleFromSession } from "@/app/dashboard/tasks/components/taskUi";

/** Window events: other components (e.g. the Tasks page button) open the modal / get told a task was created. */
export const NEW_TASK_EVENT = "oms:new-task";
export const TASK_CREATED_EVENT = "oms:task-created";

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Single owner of the "New Task" modal, mounted once in the root layout so
 * Alt+N works on every OMS page. Alt+N is used (not a bare letter) because it
 * works even while typing in a field and doesn't clash with page shortcuts or
 * browser ones (Ctrl+N is taken by the browser).
 */
export default function GlobalTaskCreate() {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [sessionRole, setSessionRole] = useState<"admin" | "manager" | "staff">("staff");
  const [users, setUsers] = useState<TaskUserDTO[]>([]);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  const openModal = useCallback(() => {
    const u = readSessionUser();
    if (!u) return;
    setMe(u.username);
    setSessionRole(roleFromSession(u));
    setOpen(true);
    api<TaskUserDTO[]>("/api/tasks/users", u.username).then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN") {
        e.preventDefault();
        openModal();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(NEW_TASK_EVENT, openModal);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(NEW_TASK_EVENT, openModal);
    };
  }, [openModal]);

  const notify = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 4000);
  }, []);

  const role = users.find((u) => u.username === me)?.role ?? sessionRole;
  const ctx: TaskCtx | null = useMemo(() => (me ? { me, role, users, notify } : null), [me, role, users, notify]);

  return (
    <>
      {open && ctx && (
        <CreateTaskModal
          ctx={ctx}
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); window.dispatchEvent(new Event(TASK_CREATED_EVENT)); notifyTasksChanged(); }}
        />
      )}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-5 py-3 rounded-xl text-sm font-bold shadow-xl ${toast.kind === "err" ? "bg-red-600 text-white" : "bg-[#0a2540] text-white"}`}>
          {toast.msg}
        </div>
      )}
    </>
  );
}
```

### `app/dashboard/urgent-tasks/page.tsx`

```tsx
// FILE: app/dashboard/urgent-tasks/page.tsx
"use client";
import { useRouter } from "next/navigation";
import BlockGuard from "@/components/BlockGuard";
import UrgentTaskManagerPanel from "@/components/UrgentTaskManagerPanel";
import { FiArrowLeft, FiAlertTriangle } from "react-icons/fi";

export default function UrgentTasksPage() {
  const router = useRouter();

  return (
    <BlockGuard
      permission="boss"
      fallback={
        <div className="flex flex-col items-center gap-2 m-4 p-4 border border-red-200 rounded-xl bg-red-50">
          <p className="text-red-500 font-bold uppercase">You have no access for this page.</p>
        </div>
      }
    >
      <div className="p-4 md:p-8 bg-[#f3f6f9] min-h-screen">
        <div className="max-w-4xl mx-auto flex flex-col gap-6">
          <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 font-bold text-xs uppercase tracking-widest w-fit">
            <FiArrowLeft /> Back
          </button>

          <div className="flex items-center gap-4">
            <div className="bg-[#dc2626] text-white p-4 rounded-2xl">
              <FiAlertTriangle size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#0a2540]">Urgent Tasks</h1>
              <p className="text-[#ff9933] text-[10px] font-black tracking-widest uppercase">Assign & Track</p>
            </div>
          </div>

          <UrgentTaskManagerPanel />
        </div>
      </div>
    </BlockGuard>
  );
}
```

### `components/UrgentTaskManagerPanel.tsx`

```tsx
// FILE: components/UrgentTaskManagerPanel.tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { FiSend, FiClock, FiCheckCircle } from "react-icons/fi";

interface UrgentTask {
  _id: string;
  description: string;
  assignedTo: string;
  assignedBy: string;
  status: "pending" | "snoozed" | "done";
  snoozeUntil?: string | null;
  createdAt: string;
  escalated: boolean;
  pendingMinutes: number;
}

const DASHBOARD_POLL_MS = 25000;

// The create-form + live pending list, shared between the full
// /dashboard/urgent-tasks page and the Header's "Urgent Tasks" popup - same
// component either way, so the two never drift out of sync.
export default function UrgentTaskManagerPanel() {
  const [users, setUsers] = useState<{ username: string }[]>([]);
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tasks, setTasks] = useState<UrgentTask[]>([]);

  // Read at submit time, not at mount. Several OMS tabs are usually open at
  // once, and a logout in any one of them clears oms_user for all of them -
  // an already-mounted panel would keep whatever it snapshotted on mount and
  // post the task with a blank assignedBy, which the API rejects with an
  // error that says nothing about the session having gone.
  const readSessionUsername = () => {
    try {
      const stored = localStorage.getItem("oms_user");
      return stored ? JSON.parse(stored)?.username || "" : "";
    } catch {
      return "";
    }
  };

  useEffect(() => {
    fetch("/api/users")
      .then((res) => res.json())
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load users", err));
  }, []);

  const fetchTasks = useCallback(() => {
    fetch("/api/urgent-tasks")
      .then((res) => res.json())
      .then((data) => setTasks(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load urgent tasks", err));
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, DASHBOARD_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || !assignedTo) {
      alert("Description aur staff dono chahiye.");
      return;
    }
    const assignedBy = readSessionUsername();
    if (!assignedBy) {
      alert("Aapka login session mil nahi raha (kisi doosre tab me logout ho gaya hoga) - dobara login karke bhejo.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/urgent-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, assignedTo, assignedBy }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create");
      }
      setDescription("");
      setAssignedTo("");
      fetchTasks();
    } catch (err: any) {
      alert(err.message || "Failed to create urgent task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Create form */}
      <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Buyer ko GeM order ka PDF WhatsApp par bhejo"
            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#0a2540] min-h-[70px]"
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 w-full space-y-1">
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Assign To</label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#0a2540]"
            >
              <option value="">Select staff...</option>
              {users.map((u) => (
                <option key={u.username} value={u.username}>{u.username}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 bg-[#0a2540] hover:bg-[#0a1628] disabled:opacity-50 text-white font-black uppercase tracking-widest text-xs py-3 px-6 rounded-xl transition-all active:scale-95 shrink-0"
          >
            <FiSend size={14} /> {submitting ? "Sending..." : "Send Urgent Task"}
          </button>
        </div>
      </form>

      {/* Live pending list */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-xs font-black uppercase tracking-wider text-[#0a2540] flex items-center gap-1.5">
            <FiClock className="text-[#0a2540]" size={14} /> Pending / Snoozed
            <span className="bg-slate-100 text-slate-600 text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
              {tasks.length}
            </span>
          </h3>
        </div>
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-widest flex flex-col items-center gap-2">
            <FiCheckCircle size={20} />
            Nothing pending — sab clear hai.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="py-2.5 px-3">Assigned To</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Pending Since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.map((t) => (
                  <tr key={t._id} className={t.escalated ? "bg-red-50" : "hover:bg-slate-50"}>
                    <td className="py-2.5 px-3 font-bold text-[#0a2540]">{t.assignedTo}</td>
                    <td className="py-2.5 px-3 text-slate-700 max-w-[220px]">{t.description}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                          t.status === "snoozed" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className={`py-2.5 px-3 text-right font-mono font-bold ${t.escalated ? "text-red-600" : "text-slate-500"}`}>
                      {t.pendingMinutes < 60 ? `${t.pendingMinutes} min` : `${Math.floor(t.pendingMinutes / 60)} hr ${t.pendingMinutes % 60} min`}
                      {t.escalated && <span className="block text-[8px] uppercase">Escalated</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

### `components/UrgentTaskPopup.tsx`

```tsx
// FILE: components/UrgentTaskPopup.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiCheckCircle, FiClock } from "react-icons/fi";

interface UrgentTaskItem {
  _id: string;
  description: string;
  assignedBy: string;
  status: "pending" | "snoozed" | "done";
  createdAt: string;
  pendingMinutes: number;
}

const POLL_MS = 25000;

// Two short beeps via the Web Audio API - no bundled sound file to fetch/host,
// and it works the same on every device.
function playAlert() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    [0, 0.35].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.3);
    });
  } catch (err) {
    console.error("Could not play urgent task alert sound", err);
  }
}

// Global, mounted once in app/layout.tsx (outside the login page) - polls for
// this logged-in user's due urgent tasks every 25s. A task only ever leaves
// the screen via "Mark as Done" or "Snooze 10 min" (no click-outside/Escape
// dismiss), matching the whole point of this feature: it can't be
// accidentally forgotten in the background.
export default function UrgentTaskPopup() {
  const [queue, setQueue] = useState<UrgentTaskItem[]>([]);
  const [busy, setBusy] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const usernameRef = useRef<string>("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("oms_user");
      if (stored) usernameRef.current = JSON.parse(stored)?.username || "";
    } catch {
      // ignore
    }
    if (!usernameRef.current) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/urgent-tasks?username=${encodeURIComponent(usernameRef.current)}`);
        const data = await res.json();
        if (!Array.isArray(data)) return;

        const hasNewOne = data.some((t: UrgentTaskItem) => !seenIdsRef.current.has(t._id));
        if (hasNewOne && data.length > 0) playAlert();
        data.forEach((t: UrgentTaskItem) => seenIdsRef.current.add(t._id));

        setQueue(data);
      } catch (err) {
        console.error("Urgent task poll failed", err);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const current = queue[0];
  if (!current) return null;

  const resolve = async (action: "done" | "snooze") => {
    setBusy(true);
    try {
      await fetch(`/api/urgent-tasks/${current._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      seenIdsRef.current.delete(current._id);
      setQueue((prev) => prev.slice(1));
    } catch (err) {
      alert("Failed to update the task — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a1628]/95 p-6">
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border-4 border-[#ff9933] overflow-hidden">
        <div className="bg-[#0a2540] px-8 py-6 flex items-center gap-4">
          <div className="bg-[#ff9933] text-[#0a2540] p-3 rounded-2xl animate-pulse">
            <FiAlertTriangle size={32} />
          </div>
          <div>
            <h1 className="text-white text-2xl font-black uppercase tracking-tight">Urgent Task</h1>
            <p className="text-[#ff9933] text-xs font-bold uppercase tracking-widest">Assigned by {current.assignedBy}</p>
          </div>
        </div>
        <div className="p-8 space-y-4">
          <p className="text-2xl font-bold text-[#0a2540] leading-snug break-words">{current.description}</p>
          <div className="flex items-center gap-2 text-slate-500 text-sm font-bold">
            <FiClock size={16} />
            Pending for {current.pendingMinutes < 1 ? "less than a minute" : `${current.pendingMinutes} minute(s)`}
          </div>
          {queue.length > 1 && (
            <p className="text-xs font-black uppercase text-slate-400">
              +{queue.length - 1} more urgent task(s) waiting after this one
            </p>
          )}
        </div>
        <div className="p-6 pt-0 flex flex-col sm:flex-row gap-3">
          <button
            disabled={busy}
            onClick={() => resolve("done")}
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black uppercase tracking-widest text-sm py-4 rounded-2xl transition-all active:scale-95"
          >
            <FiCheckCircle size={18} /> Mark as Done
          </button>
          <button
            disabled={busy}
            onClick={() => resolve("snooze")}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-[#0a2540] font-black uppercase tracking-widest text-sm py-4 rounded-2xl transition-all active:scale-95"
          >
            <FiClock size={18} /> Snooze 10 min
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## 9. Background jobs & reminders

**Sach ye hai ki is module ka koi background job, cron, scheduler ya notification sender nahi hai.** DEV OMS Vercel par serverless chalta hai, aur usme koi always-on process nahi hai.

Jo "time-based" cheezein kaam karti hain, woh sab **read time par ya client-side polling** se hoti hain:

| Cheez | Kaise hoti hai | Code |
|---|---|---|
| Overdue | Query time par `dueAt < now` (status active ho) | `statFilter()` / `listTasks()` in `taskService.ts` |
| Due today / Follow-ups today | IST din ki seema `istDayBounds()` se | `lib/tasks/ist.ts` |
| Navbar badge refresh | Browser har 60s poll karta hai (tab visible ho tab), focus par, aur `tasks:changed` event par | `usePendingTaskCount.ts` |
| Tasks page refresh | Har 30s (tab visible ho tab) | `app/dashboard/tasks/page.tsx` |
| Urgent popup | Har 25s poll (abhi disabled) | `UrgentTaskPopup.tsx` |
| Urgent escalation (1 ghanta) | GET ke time par calculate hota hai (`withEscalation`), save nahi hota | `app/api/urgent-tasks/route.ts` |
| Urgent snooze (10 min) | `snoozeUntil` save hota hai; GET `snoozeUntil <= now` wale ko wapas dikhata hai | `app/api/urgent-tasks/[id]/route.ts` |

**Jo NAHI bana (sirf schema ready hai):**
- **Recurring daily/weekly/monthly tasks:** `Task.recurrence { enabled, rule, weekdays, dayOfMonth, parentTaskId, nextRunAt }` aur `source: "RECURRING"`. Inhe banane wala koi job nahi hai.
- **Reminders / WhatsApp / push / email:** `Task.lastReminderAt`, activity type `REMINDER_SENT`, `TaskSettings.whatsappEnabled / whatsappMaxPerMinute / dailyDigestTime / eveningSummaryTime`.
- **Escalation:** `Task.escalationLevel`, activity type `ESCALATED`, `TaskSettings.escalateToManagerAfterHours / escalateToAdminAfterHours / workStartHour / workEndHour / workingDays / holidays / pauseSlaWhenWaiting`.

DEV-BID mein ye chahiye to naya banana padega. Ek simple tareeka:
1. Ek route banayein, jaise `POST /api/tasks/cron`, jo `recurrence.enabled && nextRunAt <= now` wale template tasks se naye tasks banaye (`source: "RECURRING"`, `recurrence.parentTaskId`), aur `nextRunAt` aage badha de.
2. Use **Vercel Cron** (`vercel.json` → `crons`) ya kisi external scheduler se chalayein, aur ek secret header se protect karein.
3. WhatsApp ke liye DEV OMS mein ek alag local `whatsapp-bridge` service hai (courier ke liye). Wahi pull pattern yahan bhi use ho sakta hai. Ye task module ka hissa nahi hai.

---

## 10. Folder structure (module ki saari files, original path ke saath)

```
<project root>/
├── app/
│   ├── layout.tsx                         (snippet - GlobalTaskCreate mount + login guard)
│   ├── globals.css                        (Tailwind import)
│   ├── login/page.tsx                     ✔ full
│   ├── api/
│   │   ├── login/route.ts                 ✔ full (password redacted)
│   │   ├── users/route.ts                 ✔ full
│   │   ├── users/[id]/route.ts            ✔ full
│   │   ├── tasks/
│   │   │   ├── route.ts                   ✔ GET list, POST create
│   │   │   ├── summary/route.ts           ✔
│   │   │   ├── pending-count/route.ts     ✔
│   │   │   ├── users/route.ts             ✔
│   │   │   └── [id]/
│   │   │       ├── route.ts               ✔ GET / PATCH / DELETE
│   │   │       ├── status/route.ts        ✔
│   │   │       ├── assign/route.ts        ✔
│   │   │       ├── verify/route.ts        ✔
│   │   │       ├── reject/route.ts        ✔
│   │   │       ├── reopen/route.ts        ✔
│   │   │       └── comments/route.ts      ✔
│   │   └── urgent-tasks/
│   │       ├── route.ts                   ✔
│   │       └── [id]/route.ts              ✔
│   └── dashboard/
│       ├── settings/page.tsx              (snippet - taskManager + managerUsername)
│       ├── urgent-tasks/page.tsx          ✔
│       └── tasks/
│           ├── page.tsx                   ✔
│           └── components/
│               ├── CreateTaskModal.tsx    ✔
│               ├── SearchableSelect.tsx   ✔
│               ├── TaskDrawer.tsx         ✔
│               ├── TaskStatsRow.tsx       ✔
│               ├── TaskTable.tsx          ✔
│               └── taskUi.ts              ✔
├── components/
│   ├── BlockGuard.tsx                     ✔
│   ├── GlobalTaskCreate.tsx               ✔
│   ├── Header.tsx                         (snippet - TASKS badge, logout, idle timeout)
│   ├── UrgentTaskManagerPanel.tsx         ✔
│   └── UrgentTaskPopup.tsx                ✔
├── lib/
│   ├── dbConnect.ts                       ✔ mongoose
│   ├── mongodb.ts                         ✔ mongodb driver
│   ├── pageTitles.ts                      (1 line - "/dashboard/tasks": "Tasks")
│   └── tasks/
│       ├── http.ts                        ✔
│       ├── ist.ts                         ✔
│       ├── permissions.ts                 ✔ getActor / roles / visibility
│       ├── taskNumber.ts                  ✔
│       ├── taskService.ts                 ✔ saara business logic
│       ├── types.ts                       ✔
│       └── usePendingTaskCount.ts         ✔
└── models/
    ├── User.js                            ✔ (schema reference only)
    ├── Task.ts                            ✔
    ├── TaskActivity.ts                    ✔
    ├── TaskFollowUp.ts                    ✔ (schema only)
    ├── TaskSettings.ts                    ✔ (schema only)
    ├── Counter.ts                         ✔
    └── UrgentTask.ts                      ✔
```

---

## 11. DEV-BID mein lagane ke steps

### A. Pehle DEV-BID check karein

Claude Code ko DEV-BID mein ye dekhna hai:

1. Kya DEV-BID **Next.js App Router** hai (`app/` folder, `app/api/**/route.ts`)? Agar Express/Pages Router hai, to route files ko us framework ke handlers mein convert karna padega. `lib/tasks/taskService.ts` aur `permissions.ts` framework-independent hain, bas `Request` / `URL` use karte hain.
2. Kya `@/*` path alias hai? Nahi hai to `tsconfig.json` mein `"paths": { "@/*": ["./*"] }` jodein.
3. Kya pehle se `users` collection, login, `lib/mongodb.ts`, `lib/dbConnect.ts`, `models/Counter`, `components/BlockGuard`, `Header` hain? Agar hain to **duplicate mat banayein** (neeche C dekhein).
4. Kya Tailwind v4 hai? UI pure Tailwind classes par bani hai.

### B. Install

```bash
npm install mongoose@8.24.1 mongodb@7.1.0 react-icons@5.5.0
# (next / react / tailwind DEV-BID mein pehle se hon to dobara mat daalein; version major same rakhein: Next 16, React 19, Tailwind 4)
```

`.env.local` mein `MONGODB_URI=<DEV-BID ka apna DB URI>`.

### C. Login / User model: conflict kaise avoid karein (merge, duplicate nahi)

Task module ko login se sirf **3 cheezein** chahiye:
1. Server par acting user ka **username** (`getActor` ke andar).
2. Us user ka document **`users`** collection mein, jisme `permissions.boss`, `permissions.taskManager` aur `managerUsername` ho.
3. Frontend par current username, taaki `api()` use `x-oms-user` header mein bhej sake. Ye `localStorage["oms_user"]` se aata hai (`readSessionUser()`).

**Case 1: DEV-BID mein pehle se login aur User model hai (recommended path)**
- DEV OMS ka `app/api/login`, `app/login/page.tsx`, `app/api/users/*` aur `models/User.js` **copy mat karein**.
- DEV-BID ke existing User schema mein sirf ye fields **jodein**: `permissions.taskManager: Boolean (default false)`, `managerUsername: String (default null)`, aur agar admin ke liye `permissions.boss` nahi hai to woh bhi (ya `getTaskRole()` ko DEV-BID ke apne admin flag/role par map karein).
- Agar DEV-BID ka user collection naam `users` nahi hai, ya username field ka naam alag hai (jaise `email`), to `lib/tasks/permissions.ts` (`usersCollection()`, `findOne({ username })`, `managerUsername`) aur `taskService.ts` (`existingUsernames`, `listTaskUsers`) mein naam badlein.
- `getActor()` ko DEV-BID ke session se jodein. Jaise JWT/cookie verify karke username nikalein, **header par bharosa na karein**. Ye change sirf ek function mein hai.
- Hardcoded admins `["admin", "chintan", "hitesh"]` teen jagah hain: `permissions.ts`, `taskService.ts` (do jagah) aur `taskUi.ts`. DEV-BID mein inhe hata dein ya apne admin usernames daalein.
- Frontend `taskUi.ts` → `readSessionUser()` aur `roleFromSession()` ko DEV-BID ke session store ke hisaab se badlein (DEV OMS: `localStorage["oms_user"] = { username, permissions }`).
- Agar DEV-BID cookie-based session use karta hai, to `api()` mein `credentials: "same-origin"` default hai, aur `x-oms-user` header ki zaroorat nahi rahegi jab `getActor` session se padhe.

**Case 2: DEV-BID mein login nahi hai**
- Section 4 ki saari files (login route, login page, users routes, `lib/mongodb.ts`) aur layout/Header snippets copy karein.
- Login route ka `<REDACTED>` fallback password **apne env variable** se padhein, jaise `process.env.ADMIN_FALLBACK_PASSWORD`. Ya behtar hai ki hardcoded admins hata kar DB mein ek `boss: true` user seed karein.
- Strong suggestion: passwords ko bcrypt/scrypt se hash karein aur `GET /api/users` se `password` field hata dein (`projection: { password: 0 }`).

**Shared files jo DEV-BID mein ho sakti hain:**
- `lib/dbConnect.ts` / `lib/mongodb.ts`: pehle se hain to **wahi use karein**. Sirf import path milayein (`@/lib/dbConnect` default export mongoose connect function hai).
- `models/Counter.ts`: agar DEV-BID mein `counters` collection kisi aur shape mein hai, to model ka naam `TaskCounter` rakhein ya collection `task_counters` karein (`taskNumber.ts` mein import badlein).
- `components/BlockGuard.tsx`: pehle se hai to wahi rakhein; urgent-tasks page sirf `permission="boss"` use karta hai.
- Mongoose model names (`Task`, `TaskActivity`, `UrgentTask` ...): DEV-BID mein same naam ka model pehle se ho, to clash hoga (`models.Task || model("Task")` purana wala utha lega). Aise mein naam badlein, jaise `OmsTask`.

### D. Files copy karein

Section 10 ke tree ke hisaab se (✔ = full file is MD mein hai):
1. `models/Task.ts`, `TaskActivity.ts`, `TaskFollowUp.ts`, `TaskSettings.ts`, `UrgentTask.ts`, `Counter.ts`
2. `lib/tasks/*` (7 files), `lib/dbConnect.ts`, `lib/mongodb.ts` (agar nahi hain)
3. `app/api/tasks/**` (11 route files), `app/api/urgent-tasks/**` (2)
4. `app/dashboard/tasks/**` (page + 6 components), `app/dashboard/urgent-tasks/page.tsx`
5. `components/GlobalTaskCreate.tsx`, `UrgentTaskManagerPanel.tsx`, `UrgentTaskPopup.tsx`, `BlockGuard.tsx`

### E. Wire-up ("routes register")

Next.js App Router mein API routes **folder rakhte hi register** ho jaate hain, alag register karne ki zaroorat nahi. Bas ye karein:
1. Root layout mein `<GlobalTaskCreate />` mount karein (sirf logged-in area mein). Section 4 ka layout snippet dekhein.
2. Header/navbar mein TASKS link + `usePendingTaskCount(username)` badge lagayein. Section 4 ka Header snippet dekhein.
3. (Optional) Urgent popup chahiye to layout mein `<UrgentTaskPopup />` mount karein. DEV OMS mein ye abhi disabled hai.
4. User management page mein `taskManager` checkbox aur `managerUsername` input jodein (section 5 snippet). Yaad rahe, DEV OMS ka `POST /api/users` naye user par `managerUsername` save nahi karta (gotcha section 4 mein).
5. **Agar DEV-BID mein `/dashboard` prefix nahi hai**, to `Header` link `/dashboard/tasks` aur page folder ka path milayein.

### F. Seed data

Mongoose indexes pehli query par apne aap bante hain (Next.js dev mein `autoIndex` on rehta hai). Production mein ek baar `Task.syncIndexes()` chalana behtar hai. Text index (`title`, `description`, ...) ek collection par ek hi ho sakta hai.

Test ke liye users (mongosh mein, apne passwords rakhein):

```js
// DEV-BID DB par - sirf Case 2 (DEV OMS jaisa plain-password login) ke liye
db.users.insertMany([
  { username: "owner1",   password: "<set-your-own>", permissions: { boss: true },        managerUsername: null },
  { username: "manager1", password: "<set-your-own>", permissions: { taskManager: true }, managerUsername: null },
  { username: "staff1",   password: "<set-your-own>", permissions: {},                    managerUsername: "manager1" },
  { username: "staff2",   password: "<set-your-own>", permissions: {},                    managerUsername: "manager1" },
  { username: "staff3",   password: "<set-your-own>", permissions: {},                    managerUsername: null }
]);
```

`counters` mein kuch seed nahi karna; `task-YYMM` doc pehle task par apne aap ban jaata hai (upsert).

### G. Run & test

```bash
npm run dev
# http://localhost:3000/login -> owner1 se login -> /dashboard/tasks
```

Phir section 12 ki checklist chalayein.

### Dependencies on DEV OMS — DEV-BID mein remove/replace karein

| Cheez | Kahan | DEV-BID mein kya karein |
|---|---|---|
| Hardcoded super-admins `admin`, `chintan`, `hitesh` + fallback password | `app/api/login/route.ts`, `app/api/users/route.ts`, `lib/tasks/permissions.ts`, `lib/tasks/taskService.ts`, `taskUi.ts` | Hatayein ya apne admin daalein; password env se lein |
| `localStorage["oms_user"]` session key | `taskUi.ts`, `usePendingTaskCount.ts`, `GlobalTaskCreate.tsx`, `UrgentTask*.tsx`, `BlockGuard.tsx`, Header, layout, login page | DEV-BID ke session key/store se badlein |
| Header naam `x-oms-user` | `taskUi.ts`, `usePendingTaskCount.ts`, `permissions.ts` | Rakh sakte hain, ya rename karein (dono taraf ek saath) |
| DB naam `"dev_oms_db"` | `app/api/login/route.ts` | Hatayein (`client.db()`) ya DEV-BID ka DB naam |
| Task categories `ORDER`, `DELIVERY`, `BILLING`, `PAYMENT_FOLLOWUP`, `BID`, `GEM_CATALOGUE`, `DOCUMENT`, `PURCHASE`, `ACCOUNTS`, `GENERAL` | `models/Task.ts` enum + `lib/tasks/types.ts` `TASK_CATEGORIES` | DEV-BID ke hisaab se rakhein ya badlein. **Dono jagah same** rakhein |
| `links` fields (`sellerOrderId`, `gemOrderNo`, `bidId`, `bidNo`, `billId`, `billNo`, `buyerName`, `buyerPhone`) | `models/Task.ts`, `taskService.ts` `LINK_KEYS`, `types.ts` `TaskDTO.links`, `CreateTaskModal` / `TaskDrawer` | DEV-BID ke liye `bidId` / `bidNo` kaam ke hain; order/bill wale hata sakte hain (teeno jagah) |
| `firm` (free text) | Task model + UI filter | Firm concept na ho to UI se chhupa dein |
| Search me `links.gemOrderNo`, `links.buyerName` | `taskService.ts` `listTasks` + text index | Links badlein to yahan bhi |
| Saare DEV OMS user permissions (`addSeller`, `purchase`, `stock`, `pricelist`, ...) | `models/User.js`, login response, settings page | Task module ko sirf `boss`, `taskManager`, `users` chahiye |
| `counters` collection orders ke saath shared | `models/Counter.ts` | DEV-BID mein clash ho to alag collection |
| `SearchableSelect` DEV OMS ke account statement page mein bhi import hota hai | `app/dashboard/account/statement/page.tsx` | DEV-BID mein irrelevant |
| Header ke DEV OMS buttons (GeM login, pricelist, metal calc, attendance) | `components/Header.tsx` | Copy na karein, sirf TASKS link lein |
| Layout ke background jobs (`/api/jobs/tick`) | `app/layout.tsx` | Copy na karein |
| Brand colours (`#0a2540`, `#ff9933`) | UI classes | Chahein to DEV-BID theme se badlein |

---

## 12. Testing checklist

Users: **owner1** (boss), **manager1** (taskManager; team = staff1, staff2), **staff1**, **staff2**, **staff3** (kisi team mein nahi).

### Login / auth
- [ ] Galat password → "Invalid username or password" (401).
- [ ] Sahi login → `/dashboard` khulta hai, `localStorage.oms_user` mein `{username, permissions}` hai.
- [ ] Logout → `oms_user` hat jaata hai, `/login` khulta hai; `/dashboard/tasks` kholne par wapas `/login`.
- [ ] Bina `x-oms-user` header ke `GET /api/tasks` → 401.

### Owner (admin) se
- [ ] Tabs: My, Watching, Assigned by Me, Team, **All** dikhte hain.
- [ ] Alt+N → New Task modal. staff1 ko task assign karo, checklist 2 items, watcher manager1 → task bana, number `TSK-YYMM-0001` format.
- [ ] Past due date se task → ban jaata hai, warning toast ke saath, aur turant Overdue mein dikhta hai.
- [ ] Drawer mein title / due / priority badlo aur checklist item add karo → activity mein EDITED / DUE_CHANGED / PRIORITY_CHANGED / CHECKLIST entries.
- [ ] (API) `PATCH /api/tasks/:id` se `category` / `firm` / `watchers` badlo → activity EDITED.
- [ ] Reassign staff1 → staff3 → staff1 watchers mein aa jaata hai; activity REASSIGNED.
- [ ] Bulk select 3 tasks → bulk reassign + bulk priority. 51 select karne par error.
- [ ] Cancel bina reason → error; reason ke saath → CANCELLED, edit block.
- [ ] Delete → task list se gayab (DB mein `isDeleted: true`).
- [ ] `/dashboard/urgent-tasks` khulta hai; urgent task assign karo; 1 ghante baad list mein escalated dikhe.

### Manager se (manager1)
- [ ] Tabs: My, Watching, Assigned by Me, Team (All **nahi**).
- [ ] Team tab mein sirf staff1/staff2 (aur khud) ke tasks; staff3 ka task (jisme manager1 watcher nahi) **nahi** dikhta.
- [ ] Assignee list mein staff3 `assignable: false` → staff3 ko assign → 403 "Aap sirf apni team ko task assign kar sakte ho".
- [ ] staff1 ka DONE task → Verify → CLOSED (`closedBy = manager1`).
- [ ] Doosra DONE task → Reject bina reason → error; reason ke saath → IN_PROGRESS.
- [ ] CLOSED task → Reopen (reason) → OPEN.
- [ ] Delete button/API → 403 "Task delete sirf admin kar sakta hai".
- [ ] manager1 ki team khali karo (staff1/2 ka `managerUsername` hatao) → ab sab tasks dikhte hain aur sabko assign kar sakta hai.

### Staff se (staff1)
- [ ] Tabs: My, Watching, Assigned by Me only. `GET /api/tasks?view=team` → 403.
- [ ] New Task: assignee sirf khud; kisi aur ko (API se) → 403 "Staff sirf apne naam par task bana sakte hain".
- [ ] Apna task: Start → IN_PROGRESS (`startedAt` set).
- [ ] Waiting bina "kiska wait" / follow-up date → error; dono ke saath → WAITING, aur "Follow-ups Today" stat follow-up ke din count karta hai.
- [ ] Resume → IN_PROGRESS; Done → DONE ("Done (verify)"), aur manager ke "To Verify" mein dikhta hai.
- [ ] `requiresVerification = false` wala task Done → seedha CLOSED.
- [ ] Checklist tick → "x/y done" activity; title edit (API PATCH title) → 403 "Staff sirf checklist tick kar sakta hai".
- [ ] Cancel → 403. Kisi aur ka (non-visible) task id kholo → 403.
- [ ] Comment `@manager1 dekh lo` → activity COMMENT, mention save (`to: ["manager1"]`).

### Common
- [ ] Navbar TASKS badge = apne pending tasks (DONE/CLOSED/CANCELLED nahi gine jaate); task banane/status badalne par turant update hota hai.
- [ ] Do browser tabs mein same task edit karo → doosre save par 409 "Task kisi aur ne update kiya hai, refresh karo".
- [ ] Stats card click → list usi filter par; search (task no / title / buyer) kaam karta hai.
- [ ] Due "Today" / "Overdue" IST ke hisaab se sahi (raat 12 baje IST ke aas-paas check karein).
- [ ] Tasks page tab hidden ho to poll ruk jaata hai, wapas aane par refresh hota hai.
