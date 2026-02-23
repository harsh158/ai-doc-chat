import Groq from "groq-sdk";
import dotenv from "dotenv";
import fs from "fs";
import readline from "readline";
import { text } from "stream/consumers";

dotenv.config();

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Load text file
async function loadDocument(filePath) {
  const text = fs.readFileSync(filePath, "utf-8");
  return text.slice(0, 20000); // Limit to first 10,000 characters for better performance
}

// Ask AI a question about the document
async function askAboutDocument(question, documentContent) {
  const response = await client.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content: `You are a helpful assistant that answers questions based ONLY on the document provided below. 
If the answer is not in the document, say "I couldn't find that in the document."

DOCUMENT CONTENT:
${documentContent}`,
      },
      {
        role: "user",
        content: question,
      },
    ],
  });

  return response.choices[0].message.content;
}

// Interactive chat loop
async function main() {
  console.log("Loading document...");
  const documentContent = await loadDocument("document.txt");
  console.log("Document loaded! You can now ask questions about it.");
  console.log('Type "exit" to quit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => {
    rl.question("You: ", async (question) => {
      if (question.toLowerCase() === "exit") {
        console.log("Goodbye!");
        rl.close();
        return;
      }

      const answer = await askAboutDocument(question, documentContent);
      console.log(`\nAI: ${answer}\n`);
      askQuestion();
    });
  };

  askQuestion();
}

main();