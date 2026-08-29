CREATE SEQUENCE "AppSetting_id_seq";

ALTER TABLE "AppSetting"
ALTER COLUMN "id" SET DEFAULT nextval('"AppSetting_id_seq"');

SELECT setval(
  '"AppSetting_id_seq"',
  COALESCE((SELECT MAX("id") FROM "AppSetting"), 0) + 1,
  false
);
