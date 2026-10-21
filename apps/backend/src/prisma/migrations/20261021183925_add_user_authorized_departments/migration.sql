-- CreateTable
CREATE TABLE "UserAuthorizedDepartment" (
    "user_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,

    CONSTRAINT "UserAuthorizedDepartment_pkey" PRIMARY KEY ("user_id","department_id")
);

-- CreateIndex
CREATE INDEX "UserAuthorizedDepartment_department_id_idx" ON "UserAuthorizedDepartment"("department_id");

-- AddForeignKey
ALTER TABLE "UserAuthorizedDepartment" ADD CONSTRAINT "UserAuthorizedDepartment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAuthorizedDepartment" ADD CONSTRAINT "UserAuthorizedDepartment_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
