import express from "express";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static("public"));

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
if (!process.env.GROQ_API_KEY) {
  console.error("WARNING: GROQ_API_KEY is not set");
}

// Multer setup for file uploads
const upload = multer({ dest: "uploads/" });

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

// Upload endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    let text = "";

    if (file.mimetype === "application/pdf") {
    const dataBuffer = new Uint8Array(fs.readFileSync(file.path));
    const pdf = await pdfjsLib.getDocument({ data: dataBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(" ");
    pages.push(pageText);
    }
    text = pages.join("\n");
    }   else {
    text = fs.readFileSync(file.path, "utf-8");
}

    // Clean up uploaded file
    fs.unlinkSync(file.path);

    // Chunk the document
    documentChunks = chunkText(text);
    console.log(`Document loaded: ${documentChunks.length} chunks created`);

    res.json({ success: true, chunks: documentChunks.length, preview: text.slice(0, 200) });
  } catch (err) {
    console.error(err);
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
    console.error(err);
    res.status(500).json({ answer: "Something went wrong: " + err.message });
  }
});

app.listen(3000, () => console.log("Server running at http://localhost:3000"));