import type { Metadata } from "next";
import ReceiveFile from "./receive-file";

export const metadata: Metadata = {
  title: "Receive document · Puente",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ReceivePage() {
  return <ReceiveFile />;
}
