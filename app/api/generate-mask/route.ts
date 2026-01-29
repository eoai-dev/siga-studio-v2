import { NextResponse } from "next/server";
import { imageUrlToBase64 } from "@/lib/utils/image";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 300; // 5 minutes

const SEGMIND_API_URL = "https://api.segmind.com/v1/automatic-mask-generator";

// Initialize Supabase with service role key for server-side operations
const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function POST(request: Request) {
  try {
    const { imageUrl, prompt } = await request.json();

    if (!imageUrl) {
      return NextResponse.json(
        { error: "Image URL is required" },
        { status: 400 }
      );
    }

    // Convert image URL to base64
    let base64Image = await imageUrlToBase64(imageUrl);

    // Ensure the base64 string doesn't include the data:image prefix
    if (base64Image.includes('data:image')) {
      base64Image = base64Image.split(',')[1];
    }

    const body = {
      prompt: prompt || "object",
      image: base64Image,
      threshold: 0.2,
      invert_mask: false,
      return_mask: true,
      grow_mask: 10,
      seed: Math.floor(Math.random() * 1000000),
      base64: true
    };

    const response = await fetch(SEGMIND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.SEGMIND_API_KEY as string
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Segmind API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    if (!data || (typeof data !== 'string' && data.status !== 'Success')) {
      throw new Error("Invalid response format from Segmind API");
    }

    // Convert base64 to buffer
    const maskBuffer = Buffer.from(
      typeof data === 'string' ? data : data.image || data.mask || data.toString(),
      'base64'
    );

    // Generate unique filename for the mask
    const timestamp = Date.now();
    const filename = `mask_${timestamp}.png`;  // Using PNG as it's commonly used for masks

    // Upload mask to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("images")
      .upload(filename, maskBuffer, {
        contentType: "image/png",
        cacheControl: "3600",
      });

    if (uploadError) {
      throw uploadError;
    }

    // Get the public URL
    const { data: { publicUrl } } = supabase.storage
      .from("images")
      .getPublicUrl(filename);

    return NextResponse.json({
      url: publicUrl,
      status: 'success'
    });

  } catch (error) {
    console.error("Mask generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error occurred" },
      { status: 500 }
    );
  }
}
