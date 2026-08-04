-- pgvector must exist before a column can be declared with its type.
-- The database image is pgvector/pgvector:pg16, so the extension is available
-- but not enabled by default; enabling it here means a fresh database gets it
-- from `migrate deploy` rather than from a step someone has to remember.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "JobDescription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT,
    "rawText" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "parsed" JSONB,
    "parsedAt" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "resumeVersionId" UUID NOT NULL,
    "jobDescriptionId" UUID,
    "atsScore" INTEGER NOT NULL,
    "matchScore" INTEGER,
    "breakdown" JSONB,
    "missingSkills" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "rubricVersion" INTEGER NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Embedding" (
    "id" UUID NOT NULL,
    "contentHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vector" vector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobDescription_userId_createdAt_idx" ON "JobDescription"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "JobDescription_contentHash_idx" ON "JobDescription"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_cacheKey_key" ON "Analysis"("cacheKey");

-- CreateIndex
CREATE INDEX "Analysis_userId_createdAt_idx" ON "Analysis"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Analysis_resumeVersionId_idx" ON "Analysis"("resumeVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Embedding_contentHash_model_key" ON "Embedding"("contentHash", "model");

-- AddForeignKey
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_jobDescriptionId_fkey" FOREIGN KEY ("jobDescriptionId") REFERENCES "JobDescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The dimension is set here rather than in the Prisma schema, which has no
-- native vector type. 1536 matches EMBEDDING_DIMENSIONS and the common
-- text-embedding-3-small output; changing it means re-embedding everything,
-- which is why the model is part of the uniqueness key.
ALTER TABLE "Embedding" ALTER COLUMN "vector" TYPE vector(1536);

-- IVFFlat over cosine distance. Deliberately created with a small list count:
-- the index only pays off past a few thousand rows, and building it now means
-- it exists before the table is large enough for the build to be slow.
CREATE INDEX IF NOT EXISTS "Embedding_vector_cosine_idx"
  ON "Embedding" USING ivfflat ("vector" vector_cosine_ops) WITH (lists = 100);
