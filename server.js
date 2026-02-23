import express from "express";
import Groq from "groq-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.get("/favicon.ico", (req, res) => res.status(204).end());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// Multer setup - memory storage, 10MB limit for Railway compatibility
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Store document chunks in memory
let documentChunks = [];

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

// Upload endpoint
app.post("/upload", upload.single("file"), handleMulterError, async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: "No file uploaded. Please select a PDF or TXT file." });
    }

    console.log("Upload received:", file.mimetype, file.size);
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

    // Chunk the document
    documentChunks = chunkText(text);
    console.log(`Document loaded: ${documentChunks.length} chunks created`);

    res.json({ success: true, chunks: documentChunks.length, preview: text.slice(0, 200) });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Ask endpoint with RAG
app.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;

    if (documentChunks.length === 0) {
      return res.json({ answer: "Please upload a document first!" });
    }

    if (!process.env.GROQ_API_KEY) {
      console.error("WARNING: GROQ_API_KEY is not set");
      return res.status(500).json({ answer: "API key not configured." });
    }

    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

    // Find relevant chunks only
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