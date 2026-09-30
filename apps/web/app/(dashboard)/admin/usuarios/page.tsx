"use client";

import { FuncionariosPanel } from "@/components/cadastros/funcionarios-panel";

export default function AdminUsuariosPage() {
  return (
    <FuncionariosPanel
      title="Usuários"
      description="Crie usuários e atribua um cargo. Canais e módulos são definidos em Cargos."
    />
  );
}
