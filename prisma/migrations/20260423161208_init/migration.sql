-- CreateTable
CREATE TABLE "Device" (
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
    "qrCodeData" TEXT NOT NULL,
    "qrCodeImagePath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LIBERADO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_assetCode_key" ON "Device"("assetCode");

-- CreateIndex
CREATE UNIQUE INDEX "Device_qrCodeData_key" ON "Device"("qrCodeData");
