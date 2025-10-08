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

app.get("/test-advanced-lipsync", (req, res) => {
  const testText = req.query.text || "Hello, how are you today?";
  const duration = parseFloat(req.query.duration) || 3.0;
  
  const lipSyncData = generateAdvancedLipSync(testText, duration);
  
  res.json({
    text: testText,
    duration: duration,
    mouthCuesCount: lipSyncData.mouthCues.length,
    lipSync: lipSyncData
  });
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
// ✅ Advanced JavaScript Lip-Sync Generator
// -------------------------
const generateAdvancedLipSync = (text, duration = 3.0) => {
  // Phonetic mapping for more accurate lip-sync
  const phoneticMap = {
    // Vowels
    'a': 'A', 'e': 'E', 'i': 'E', 'o': 'O', 'u': 'O', 'y': 'E',
    // Consonants - Bilabial (lips together)
    'b': 'P', 'p': 'P', 'm': 'P',
    // Consonants - Labiodental (lip to teeth)
    'f': 'F', 'v': 'F',
    // Consonants - Dental/Alveolar (tongue to teeth/ridge)
    't': 'T', 'd': 'T', 'n': 'T', 'l': 'T', 's': 'S', 'z': 'S',
    // Consonants - Velar (back of tongue to soft palate)
    'k': 'K', 'g': 'K',
    // Consonants - Special cases
    'th': 'TH', 'sh': 'S', 'ch': 'T', 'j': 'T', 'r': 'A',
    // Default
    'default': 'A'
  };

  // Split text into words and analyze each character
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  const mouthCues = [];
  let currentTime = 0;
  
  // Calculate timing based on text complexity
  const totalCharacters = text.length;
  const avgCharDuration = duration / totalCharacters;
  
  words.forEach((word, wordIndex) => {
    const wordStartTime = currentTime;
    let wordDuration = 0;
    
    // Analyze each character in the word
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      const nextChar = word[i + 1];
      
      // Handle special combinations
      let mouthShape = 'A';
      if (char === 't' && nextChar === 'h') {
        mouthShape = phoneticMap['th'];
        i++; // Skip next character
      } else if (char === 's' && nextChar === 'h') {
        mouthShape = phoneticMap['sh'];
        i++; // Skip next character
      } else if (char === 'c' && nextChar === 'h') {
        mouthShape = phoneticMap['ch'];
        i++; // Skip next character
      } else {
        mouthShape = phoneticMap[char] || phoneticMap['default'];
      }
      
      // Calculate character duration with variation
      const baseDuration = avgCharDuration * (0.8 + Math.random() * 0.4);
      const charDuration = Math.max(0.05, baseDuration); // Minimum 50ms
      
      // Add mouth cue
      mouthCues.push({
        start: currentTime,
        end: currentTime + charDuration,
        value: mouthShape
      });
      
      currentTime += charDuration;
      wordDuration += charDuration;
    }
    
    // Add small pause between words (except last word)
    if (wordIndex < words.length - 1) {
      const pauseDuration = Math.random() * 0.1 + 0.05; // 50-150ms pause
      currentTime += pauseDuration;
    }
  });
  
  // Ensure we don't exceed the duration
  if (currentTime > duration) {
    const scale = duration / currentTime;
    mouthCues.forEach(cue => {
      cue.start *= scale;
      cue.end *= scale;
    });
  }
  
  // Add some natural variation to make it look more realistic
  mouthCues.forEach((cue, index) => {
    if (Math.random() < 0.1) { // 10% chance to vary
      const variations = ['A', 'E', 'O'];
      cue.value = variations[Math.floor(Math.random() * variations.length)];
    }
  });
  
  console.log(`Generated ${mouthCues.length} advanced mouth cues for "${text}" (${duration}s)`);
  return {
    mouthCues: mouthCues
  };
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
          console.log("Lip sync failed, using advanced fallback:", error.message);
          // Use advanced JavaScript lip-sync generator
          const audioDuration = Math.max(2.0, textInput.length * 0.08); // Estimate based on text length
          message.lipsync = generateAdvancedLipSync(textInput, audioDuration);
        }

        const audioFilePath = path.join(tempPath, `message_${i}.mp3`);
        message.audio = await audioFileToBase64(audioFilePath);
      } catch (error) {
        console.error("Audio generation failed:", error);
        // Fallback: return text without audio but with advanced lip-sync
        message.audio = null;
        const audioDuration = Math.max(2.0, textInput.length * 0.08);
        message.lipsync = generateAdvancedLipSync(textInput, audioDuration);
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
