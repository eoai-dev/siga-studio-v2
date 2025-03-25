import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import * as path from "path";
import * as os from "os";
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  let tempFilePath = null;
  let originalFilePath = null;
  
  try {
    // Check if GROQ API key is set
    if (!process.env.GROQ_API_KEY) {
      console.error("GROQ_API_KEY environment variable is not set");
      return NextResponse.json(
        { error: "GROQ_API_KEY is not configured" },
        { status: 500 }
      );
    }

    // Get the form data with the audio file
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;
    
    if (!audioFile) {
      console.error("No audio file provided in request");
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }
    
    console.log(`📢 Received audio: ${audioFile.name}, ${audioFile.size} bytes, type: ${audioFile.type}`);
    
    // Create a temporary file with the correct extension based on MIME type
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    
    // Determine the best extension based on audio type
    let fileExtension = 'm4a'; // default to m4a which Groq handles well
    if (audioFile.type.includes('webm')) {
      fileExtension = 'webm';
    } else if (audioFile.type.includes('mp3')) {
      fileExtension = 'mp3';
    } else if (audioFile.type.includes('wav')) {
      fileExtension = 'wav';
    }
    
    originalFilePath = path.join(tempDir, `audio-${timestamp}.${fileExtension}`);
    tempFilePath = originalFilePath;
    
    // Convert the audio file to buffer and write to temporary file
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(originalFilePath, buffer);
    
    console.log(`📤 Saved audio to temp file: ${tempFilePath}`);
    console.log("📤 Calling Groq API for transcription...");

    // Use a different approach with ffmpeg to convert the audio to a format Groq can handle better
    const ffmpegOutputPath = path.join(tempDir, `converted-${timestamp}.mp3`);
    
    // First convert with ffmpeg to a more compatible format (mp3)
    console.log(`Converting audio to mp3 format with ffmpeg...`);
    
    try {
      // Use ffmpeg to convert the file to mp3 format
      const ffmpegCommand = `ffmpeg -i "${tempFilePath}" -vn -ar 44100 -ac 2 -b:a 192k "${ffmpegOutputPath}"`;
      await execAsync(ffmpegCommand);
      console.log(`✅ Successfully converted audio to mp3 format at ${ffmpegOutputPath}`);
      
      // Replace the original file path with the converted one
      tempFilePath = ffmpegOutputPath;
    } catch (ffmpegError) {
      console.error(`❌ Error converting audio with ffmpeg:`, ffmpegError);
      console.log(`Proceeding with original file...`);
      // Continue with the original file if ffmpeg fails
    }
    
    // Use curl command which reliably works with file uploads
    // Use the -s flag to be silent (remove verbose mode that can clutter logs)
    const curlCommand = `curl -s -X POST https://api.groq.com/openai/v1/audio/transcriptions \
      -H "Authorization: Bearer ${process.env.GROQ_API_KEY}" \
      -F file=@"${tempFilePath}" \
      -F model="whisper-large-v3-turbo" \
      -F language="en" \
      -F response_format="json"`;
      
    console.log(`Executing curl command to call Groq API...`);
    
    try {
      // Execute curl command
      const { stdout, stderr } = await execAsync(curlCommand);
      
      // Clean up temp files
      try {
        // Clean up original file if it exists
        if (originalFilePath) {
          try {
            await unlink(originalFilePath);
          } catch (error) {
            console.warn(`⚠️ Could not delete original file: ${originalFilePath}`);
          }
        }
        
        // Clean up converted file if it's different from the original
        if (tempFilePath && tempFilePath !== originalFilePath) {
          try {
            await unlink(tempFilePath);
          } catch (error) {
            console.warn(`⚠️ Could not delete converted file: ${tempFilePath}`);
          }
        }
        
        console.log(`🧹 Cleaned up temp files`);
        tempFilePath = null;
        originalFilePath = null;
      } catch (cleanupError) {
        console.warn(`⚠️ Error during file cleanup: ${cleanupError}`);
      }
      
      // In verbose mode, stderr will contain connection details even for successful requests
      if (stderr) {
        console.log("📝 curl verbose output:", stderr);
      }
      
      if (!stdout) {
        throw new Error("Empty response from Groq API");
      }
      
      // Log the raw response for debugging
      console.log('Raw Groq API response:', stdout);
      
      // Parse the JSON response
      const transcriptionData = JSON.parse(stdout);
      
      // Log more detailed information
      if (transcriptionData.text) {
        console.log(`✅ Groq transcription success: "${transcriptionData.text.substring(0, 100)}${transcriptionData.text.length > 100 ? '...' : ''}"`);
      } else {
        console.log('⚠️ Groq returned no text in transcript. Complete response:', transcriptionData);
      }
      
      return NextResponse.json(transcriptionData);
    } catch (curlError) {
      console.error("🔴 Error with curl command:", curlError);
      
      // Return proper error information
      return NextResponse.json(
        { 
          error: "Groq API transcription failed", 
          details: curlError instanceof Error ? curlError.message : String(curlError)
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("🔴 Error in transcribe-audio API:", error);
    
    // Clean up temp files
    if (originalFilePath) {
      try {
        await unlink(originalFilePath);
      } catch {}
    }
    
    if (tempFilePath && tempFilePath !== originalFilePath) {
      try {
        await unlink(tempFilePath);
      } catch {}
    }
    
    return NextResponse.json(
      { 
        error: "Failed to transcribe audio", 
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
