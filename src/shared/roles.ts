export const roles = ['PATIENT', 'PROFESSIONAL', 'ADMIN'] as const;

export type Role = (typeof roles)[number];
