CREATE TYPE participant_role AS ENUM ('RIDER', 'DRIVER');

ALTER TABLE users
  ADD COLUMN participant_role participant_role NOT NULL DEFAULT 'RIDER';
