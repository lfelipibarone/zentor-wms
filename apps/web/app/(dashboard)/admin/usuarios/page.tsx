"use client";

import { FuncionariosPanel } from "@/components/cadastros/funcionarios-panel";

export default function AdminUsuariosPage() {
  return (
    <FuncionariosPanel
      title="Usuários e permissões"
      description="Crie usuários e controle o que cada um pode acessar no Help Route."
    />
  );
}
