/*
  Warnings:

  - You are about to drop the column `qrCodeData` on the `Device` table. All the data in the column will be lost.
  - You are about to drop the column `qrCodeImagePath` on the `Device` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Device" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "companyName" TEXT NOT NULL,
    "thirdPartyResponsible" TEXT,
    "teamLeader" TEXT NOT NULL,
    "notebookResponsibleName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "matriculaPlanta" TEXT NOT NULL,
    "responsiblePhotoPath" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LIBERADO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Device" ("assetCode", "companyName", "contactPhone", "createdAt", "department", "id", "matriculaPlanta", "notebookResponsibleName", "responsiblePhotoPath", "status", "teamLeader", "thirdPartyResponsible", "updatedAt") SELECT "assetCode", "companyName", "contactPhone", "createdAt", "department", "id", "matriculaPlanta", "notebookResponsibleName", "responsiblePhotoPath", "status", "teamLeader", "thirdPartyResponsible", "updatedAt" FROM "Device";
DROP TABLE "Device";
ALTER TABLE "new_Device" RENAME TO "Device";
CREATE UNIQUE INDEX "Device_assetCode_key" ON "Device"("assetCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
