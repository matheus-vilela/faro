export type ProductSetupPrimaryAction = {
  label: string;
  disabled: boolean;
  busy: boolean;
  run: () => void;
};
