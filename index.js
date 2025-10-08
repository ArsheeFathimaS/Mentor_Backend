import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node";
import express from "express";
import { promises as fs } from "fs";
import OpenAI from "openai";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "-",
});

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "ymu001dDcWSSzffANts3";

const app = express();
app.use(express.json());

// --- ✅ CORS setup ---
const allowedOrigins = [
  "https://virtual-mentor-frontend.vercel.app",
  "https://virtual-mentor-frontend.vercel.app/",
  "http://localhost:5173",
  "https://mentor-frontend.vercel.app",
  "https://mentor-frontend.vercel.app/", 
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);

const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/voices", async (req, res) => {
  res.send(await voice.getVoices(elevenLabsApiKey));
});

// -------------------------
// ✅ FIXED lipSyncMessage()
// -------------------------
const lipSyncMessage = async (messageIndex) => {
  const start = Date.now();
  console.log(`Starting conversion for message ${messageIndex}`);

  const tempPath = os.tmpdir();
  const inputAudioPath = path.join(tempPath, `message_${messageIndex}.mp3`);
  const outputAudioPath = path.join(tempPath, `message_${messageIndex}.wav`);
  const outputJsonPath = path.join(tempPath, `message_${messageIndex}.json`);

  // --- Convert MP3 → WAV using ffmpeg ---
  await new Promise((resolve, reject) => {
    // Try different FFmpeg paths for Railway
    const ffmpegPaths = [
      "ffmpeg",
      "/usr/bin/ffmpeg",
      "/usr/local/bin/ffmpeg"
    ];
    
    let ffmpegPath = ffmpegPaths[0];
    const ffmpeg = spawn(
      ffmpegPath,
      ["-y", "-i", inputAudioPath, outputAudioPath],
      { shell: false }
    );

    ffmpeg.stderr.on("data", (data) => {
      console.log("FFmpeg stderr:", data.toString());
    });

    ffmpeg.on("error", (err) => {
      console.error("FFmpeg error:", err);
      // If FFmpeg is not available, skip conversion and use MP3 directly
      console.log("FFmpeg not available, using MP3 directly");
      resolve();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        console.log(`Conversion done in ${Date.now() - start}ms`);
        resolve();
      } else {
        console.log(`FFmpeg exited with code ${code}, using MP3 directly`);
        resolve(); // Don't fail, just use MP3
      }
    });
  });

  // --- Detect Rhubarb executable path ---
  const rhubarbPath = path.join(__dirname, ".bin", process.platform === "win32" ? "rhubarb.exe" : "rhubarb");


  console.log("Running rhubarb:", rhubarbPath);

  // --- Run Rhubarb ---
  await new Promise((resolve, reject) => {
    const rhubarb = spawn(
      rhubarbPath,
      ["-f", "json", "-o", outputJsonPath, outputAudioPath, "-r", "phonetic"],
      { shell: false }
    );

    rhubarb.stderr.on("data", (data) => {
      console.error("Rhubarb error:", data.toString());
    });

    rhubarb.on("close", (code) => {
      if (code === 0) {
        console.log(`Lip sync done in ${Date.now() - start}ms`);
        resolve();
      } else {
        reject(new Error(`Rhubarb exited with code ${code}`));
      }
    });

    rhubarb.on("error", (err) => {
      console.error("Failed to start rhubarb:", err);
      reject(err);
    });
  });
};

// -------------------------
// ✅ Chat Endpoint
// -------------------------
app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  // If no message, return default sample
  if (!userMessage) {
    try {
      const sampleAudioPath = path.join(__dirname, "audios", "message_0.mp3");
      const sampleLipsyncPath = path.join(__dirname, "audios", "message_0.json");

      const audioData = await audioFileToBase64(sampleAudioPath);
      const lipsyncData = await readJsonTranscript(sampleLipsyncPath);

      res.send({
        messages: [
          {
            text: "Hi there! You can call me MentorBot.",
            facialExpression: "smile",
            animation: "Talking_1",
            audio: audioData,
            lipsync: lipsyncData,
          },
        ],
      });
    } catch (error) {
      console.error("Error loading sample audio:", error);
      res.send({
        messages: [
          {
            text: "Hello! How can I help you today?",
            facialExpression: "smile",
            animation: "Talking_1",
            audio: null,
            lipsync: null,
          },
        ],
      });
    }
    return;
  }

  // Check for missing API keys
  if (!elevenLabsApiKey || openai.apiKey === "-") {
    console.log("API keys missing, returning text-only response");
    // Return text-only response instead of error
    res.send({
      messages: [
        {
          text: userMessage ? `I received your message: "${userMessage}". However, I need API keys to provide voice responses. Please configure OpenAI and ElevenLabs API keys.` : "Hello! I need API keys to provide voice responses. Please configure OpenAI and ElevenLabs API keys.",
          facialExpression: "default",
          animation: "Idle",
          audio: null,
          lipsync: null,
        },
      ],
    });
    return;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-1106",
      max_tokens: 1000,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
          You are a virtual mentor for kids of age 6-18.
          You will always reply with a JSON array of messages (max 6).
          Each message has a text, facialExpression, and animation property.
          The different facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
          The different animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry.
          `,
        },
        { role: "user", content: userMessage || "Hello" },
      ],
    });

    let messages = JSON.parse(completion.choices[0].message.content);
    if (messages.messages) messages = messages.messages;

    // Process each message: TTS + Rhubarb lipsync
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const tempPath = os.tmpdir();
      const fileName = path.join(tempPath, `message_${i}.mp3`);
      const textInput = message.text;

      try {
        await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, textInput);
        console.log(`Audio file created: ${fileName}`);
        
        // Check if file exists
        try {
          await fs.access(fileName);
          console.log("Audio file exists, proceeding with processing");
        } catch (error) {
          console.error("Audio file not found:", error);
          throw new Error("Failed to create audio file");
        }
        
        try {
          await lipSyncMessage(i);
          const lipsyncFilePath = path.join(tempPath, `message_${i}.json`);
          message.lipsync = await readJsonTranscript(lipsyncFilePath);
        } catch (error) {
          console.log("Lip sync failed, using default:", error.message);
          message.lipsync = null; // Use default lip sync
        }

        const audioFilePath = path.join(tempPath, `message_${i}.mp3`);
        message.audio = await audioFileToBase64(audioFilePath);
      } catch (error) {
        console.error("Audio generation failed:", error);
        // Fallback: return text without audio
        message.audio = null;
        message.lipsync = null;
      }
    }

    res.send({ messages });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "An error occurred while processing your request." });
  }
});

// -------------------------
// ✅ Utility Functions
// -------------------------
const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

// -------------------------
app.listen(port, () => {
  console.log(`Virtual Mentor listening on port ${port}`);
});
