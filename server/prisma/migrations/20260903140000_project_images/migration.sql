-- Project screenshots: JSON-encoded string[] (max 8). Cover stays in coverImageUrl.
ALTER TABLE "projects" ADD COLUMN "imageUrls" TEXT;
