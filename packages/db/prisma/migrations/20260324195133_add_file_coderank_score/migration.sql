-- CreateTable
CREATE TABLE "FileCodeRankScore" (
    "id" SERIAL NOT NULL,
    "repoId" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "FileCodeRankScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileCodeRankScore_repoId_idx" ON "FileCodeRankScore"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "FileCodeRankScore_repoId_filePath_key" ON "FileCodeRankScore"("repoId", "filePath");

-- AddForeignKey
ALTER TABLE "FileCodeRankScore" ADD CONSTRAINT "FileCodeRankScore_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
