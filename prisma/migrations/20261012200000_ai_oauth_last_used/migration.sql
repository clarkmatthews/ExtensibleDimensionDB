ALTER TABLE "OauthConnection" ADD COLUMN "lastUsedAt" TIMESTAMP(3);
CREATE INDEX "OauthConnection_userId_product_idx" ON "OauthConnection"("userId", "product");
