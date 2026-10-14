ALTER TABLE "Document"
ADD COLUMN "storage_key" TEXT;

CREATE TABLE "AiAnswerHistory" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "has_answer" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAnswerHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiAnswerHistory_request_id_key"
ON "AiAnswerHistory"("request_id");

CREATE INDEX "AiAnswerHistory_user_id_created_at_idx"
ON "AiAnswerHistory"("user_id", "created_at");
