import type { UserDoc } from '../models/user.model';

export interface Author {
  id: string;
  name: string;
  picture: string;
}

// Author identity is denormalized onto events (see event.model.ts).
export function toAuthor(user: UserDoc): Author {
  return { id: String(user._id), name: user.displayName, picture: user.picture };
}
