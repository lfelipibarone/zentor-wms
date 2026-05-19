import { redirect } from "next/navigation";

export default function PulmaoRedirectPage() {
  redirect("/recebimentos?tab=pulmao");
}
