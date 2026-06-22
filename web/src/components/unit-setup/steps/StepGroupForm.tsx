import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StepGroupForm({
  groupName,
  onGroupNameChange,
}: {
  groupName: string;
  onGroupNameChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Nesta etapa você cria apenas o grupo que reunirá suas unidades. Na
        próxima etapa, cadastre a unidade com CNPJ e nome fantasia.
      </p>
      <div className="space-y-2">
        <Label htmlFor="grp">Nome do grupo *</Label>
        <Input
          id="grp"
          placeholder="Ex.: Rede Centro"
          value={groupName}
          onChange={(e) => onGroupNameChange(e.target.value)}
        />
      </div>
    </div>
  );
}
