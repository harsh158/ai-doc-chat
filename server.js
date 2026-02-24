import express from "express";
import session from "express-session";
import Groq from "groq-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import bcrypt from "bcryptjs";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const USERS_FILE = path.join(__dirname, "data", "users.json");

function readUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

app.get("/favicon.ico", (req, res) => res.status(204).end());
app.use(express.json({ limit: "10mb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);
app.use(express.static("public"));

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: "Unauthorized. Please log in." });
}

// Multer setup - memory storage, 10MB limit for Railway compatibility
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Document chunks per user (userId -> chunks)
const documentChunksByUser = new Map();

// Split text into chunks
function chunkText(text, chunkSize = 500, overlap = 100) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

// Simple relevance scoring using keyword matching
function findRelevantChunks(question, chunks, topN = 5) {
  const keywords = question.toLowerCase().split(" ").filter(w => w.length > 3);

  const scored = chunks.map((chunk, index) => {
    const lower = chunk.toLowerCase();
    const score = keywords.reduce((acc, word) => {
      return acc + (lower.split(word).length - 1);
    }, 0);
    return { chunk, score, index };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(item => item.chunk)
    .join("\n\n");
}

// Multer error handler
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ success: false, error: "File too large. Maximum size is 10MB." });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  next(err);
}

// ——— Auth routes ———
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const e = (email || "").trim().toLowerCase();
    const p = password || "";
    if (!e || !p) {
      return res.status(400).json({ success: false, error: "Email and password required." });
    }
    if (p.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters." });
    }
    const users = readUsers();
    if (users.some((u) => u.email === e)) {
      return res.status(400).json({ success: false, error: "Email already registered." });
    }
    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(p, 10);
    users.push({ id, email: e, passwordHash: hash });
    writeUsers(users);
    req.session.userId = id;
    req.session.userEmail = e;
    res.json({ success: true, user: { id, email: e } });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const e = (email || "").trim().toLowerCase();
    const p = password || "";
    if (!e || !p) {
      return res.status(400).json({ success: false, error: "Email and password required." });
    }
    const users = readUsers();
    const user = users.find((u) => u.email === e);
    if (!user || !(await bcrypt.compare(p, user.passwordHash))) {
      return res.status(401).json({ success: false, error: "Invalid email or password." });
    }
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.json({ success: true, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {});
  res.json({ success: true });
});

app.get("/api/auth/me", (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ user: { id: req.session.userId, email: req.session.userEmail } });
  }
  res.status(401).json({ error: "Not logged in" });
});

// ——— Protected upload & ask ———
app.post("/upload", requireAuth, upload.single("file"), handleMulterError, async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: "No file uploaded. Please select a PDF or TXT file." });
    }

    const userId = req.session.userId;
    console.log("Upload received:", file.mimetype, file.size, "user:", userId);
    let text = "";

    if (file.mimetype === "application/pdf") {
      const dataBuffer = new Uint8Array(file.buffer);
      const pdf = await pdfjsLib.getDocument({ data: dataBuffer }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(" ");
        pages.push(pageText);
      }
      text = pages.join("\n");
    } else {
      text = file.buffer.toString("utf-8");
    }

    const documentChunks = chunkText(text);
    documentChunksByUser.set(userId, documentChunks);
    console.log(`Document loaded for user ${userId}: ${documentChunks.length} chunks`);

    res.json({ success: true, chunks: documentChunks.length, preview: text.slice(0, 200) });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/ask", requireAuth, async (req, res) => {
  try {
    const { question } = req.body;
    const userId = req.session.userId;
    const documentChunks = documentChunksByUser.get(userId) || [];

    if (documentChunks.length === 0) {
      return res.json({ answer: "Please upload a document first!" });
    }

    if (!process.env.GROQ_API_KEY) {
      console.error("WARNING: GROQ_API_KEY is not set");
      return res.status(500).json({ answer: "API key not configured." });
    }

    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const relevantContext = findRelevantChunks(question, documentChunks);

    const response = await client.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that answers questions based ONLY on the document excerpts below.
Format your answers clearly with line breaks where needed.
If the answer is not in the excerpts, say "I couldn't find that in the document."

RELEVANT DOCUMENT EXCERPTS:
${relevantContext}`,
        },
        { role: "user", content: question },
      ],
    });

    res.json({ answer: response.choices[0].message.content });
  } catch (err) {
    console.error("Ask error:", err);
    res.status(500).json({ answer: "Something went wrong: " + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));