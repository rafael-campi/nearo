// A versão web (só desenvolvimento e testes automatizados) não envia posição em segundo plano.
export async function isTracking(): Promise<boolean> {
  return false;
}
export async function startTracking(_target: { serviceRequestId: string; companyId: string }): Promise<boolean> {
  return false;
}
export async function stopTracking(): Promise<void> {}
export async function trackedTarget(): Promise<{ serviceRequestId: string; companyId: string } | null> {
  return null;
}
