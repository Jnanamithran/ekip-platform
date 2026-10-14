CREATE TABLE "AiRequestProgress" (
    "request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRequestProgress_pkey" PRIMARY KEY ("request_id")
);

CREATE INDEX "AiRequestProgress_created_at_idx"
ON "AiRequestProgress"("created_at");
