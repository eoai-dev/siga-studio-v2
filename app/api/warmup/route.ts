import { NextResponse } from "next/server";
import Replicate from "replicate";

export const maxDuration = 300; // 5 minutes

// Initialize Replicate
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export async function POST() {
  try {
    const warmupPromises = [
      // Warm up image generation
      replicate.run("black-forest-labs/flux-dev", {
        input: {
          prompt: "warm up request",
          guidance: 3.5,
          output_format: "jpg",
          go_fast: true,
        },
      }),

      // Warm up inpainting
      replicate.run(
        "zsxkib/flux-dev-inpainting:ca8350ff748d56b3ebbd5a12bd3436c2214262a4ff8619de9890ecc41751a008",
        {
          input: {
            image: `${process.env.SUPABASE_URL}/storage/v1/object/public/images/warmup-image.webp`,
            mask: `${process.env.SUPABASE_URL}/storage/v1/object/public/images/warmup-mask.png`,
            prompt: "replace the cold brew sign with a margarita sign",
            strength: 1,
            output_quality: 90,
          },
        }
      ),

      // Warm up Segmind API
      fetch("https://api.segmind.com/v1/automatic-mask-generator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.SEGMIND_API_KEY as string,
        },
        body: JSON.stringify({
          prompt: "warm up request",
          image: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2NjIpLCBxdWFsaXR5ID0gOTAK/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A+f6KKK/oA/n8/9k=",
          threshold: 0.2,
          invert_mask: false,
          return_mask: true,
          grow_mask: 10,
          seed: 42,
          base64: true,
        }),
      }),
    ];

    await Promise.all(warmupPromises);

    return NextResponse.json({ success: true, message: "Warm-up completed successfully" });
  } catch (error) {
    console.error("Warm-up error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error occurred" },
      { status: 500 }
    );
  }
}
