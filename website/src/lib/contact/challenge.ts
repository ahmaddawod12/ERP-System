import { SignJWT, jwtVerify } from "jose";

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

function getChallengeSecret(): Uint8Array {
  const raw = process.env.CONTACT_CHALLENGE_SECRET || process.env.WEBSITE_SESSION_SECRET;
  if (!raw) {
    throw new Error("CONTACT_CHALLENGE_SECRET or WEBSITE_SESSION_SECRET must be set");
  }
  return new TextEncoder().encode(raw);
}

export interface ContactChallenge {
  question: string;
  token: string;
}

export async function createContactChallenge(): Promise<ContactChallenge> {
  const secret = getChallengeSecret();
  const token = await new SignJWT({ answer: "7" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS} sec`)
    .sign(secret);

  return {
    question: "3 + 4",
    token,
  };
}

export async function verifyContactChallenge(token: string, answer: string): Promise<boolean> {
  try {
    const secret = getChallengeSecret();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    return String(payload.answer) === String(answer).trim();
  } catch {
    return false;
  }
}
