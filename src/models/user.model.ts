import { Schema, model, Document } from 'mongoose';

export interface UserDoc extends Document {
  googleId: string;
  email: string;
  displayName: string;
  googleName: string;
  picture: string;
  onboardedAt: Date | null;
  createdAt: Date;
  lastLoginAt: Date;
}

const userSchema = new Schema<UserDoc>({
  googleId: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true },
  displayName: { type: String, required: true, trim: true },
  googleName: { type: String, default: '' },
  picture: { type: String, default: '' },
  // null until the user confirms their name on first login; the guard reads this.
  onboardedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date, default: Date.now },
});

export const UserModel = model<UserDoc>('User', userSchema);
