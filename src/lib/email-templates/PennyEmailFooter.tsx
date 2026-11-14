import * as React from "react";
import { Img, Link, Text } from "@react-email/components";
import {
  EMAIL_LOGO_URL,
  EMAIL_SITE_URL,
  EMAIL_SUPPORT_ADDRESS,
  EMAIL_PRIVACY_URL,
  EMAIL_TERMS_URL,
  EMAIL_FAQ_URL,
} from "@/lib/email-config";

const footer: React.CSSProperties = {
  fontSize: "12px",
  color: "#999999",
  margin: "24px 0 0",
  lineHeight: "1.5",
};

export function PennyEmailHeader() {
  return (
    <Img
      src={EMAIL_LOGO_URL}
      alt="Penny"
      width={200}
      height={68}
      style={{ display: "block", margin: "0 0 24px", maxWidth: "200px", height: "auto" }}
    />
  );
}

/**
 * Consistent Penny footer for transactional / auth emails.
 */
export function PennyEmailFooter({
  disclaimer,
}: {
  disclaimer?: string;
}) {
  return (
    <>
      {disclaimer ? <Text style={footer}>{disclaimer}</Text> : null}
      <Text style={footer}>
        Penny Teacher —{" "}
        <Link href={EMAIL_SITE_URL} style={{ color: "#4A6B4A" }}>
          pennyteacher.co.za
        </Link>
        <br />
        <Link href={EMAIL_FAQ_URL} style={{ color: "#4A6B4A" }}>
          Help
        </Link>
        {" · "}
        <Link href={EMAIL_PRIVACY_URL} style={{ color: "#4A6B4A" }}>
          Privacy
        </Link>
        {" · "}
        <Link href={EMAIL_TERMS_URL} style={{ color: "#4A6B4A" }}>
          Terms
        </Link>
        <br />
        Questions? Reply to this email or write to{" "}
        <Link href={`mailto:${EMAIL_SUPPORT_ADDRESS}`} style={{ color: "#4A6B4A" }}>
          {EMAIL_SUPPORT_ADDRESS}
        </Link>
        <br />
        © {new Date().getFullYear()} Penny Teacher. All rights reserved.
      </Text>
    </>
  );
}
