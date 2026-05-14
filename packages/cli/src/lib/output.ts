export type Outcome = 'ok' | 'question' | 'error' | 'success' | 'not_implemented';

export interface OutputContext {
  command: string;
  json: boolean;
}

export interface QuestionOption {
  value: string;
  label: string;
}

export interface Question {
  id: string;
  message: string;
  options?: QuestionOption[];
}

export function envelope(command: string, outcome: Outcome, result: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    command,
    outcome,
    questions: [],
    warnings: [],
    errors: [],
    ...result,
  };
}

export function printHuman(body: any) {
  if (body.message) console.log(body.message);
  if (body.warnings?.length) body.warnings.forEach((warning: string) => console.warn(`warning: ${warning}`));
  if (body.errors?.length) body.errors.forEach((error: any) => console.error(error.message || error));
  if (body.questions?.length) {
    body.questions.forEach((question: Question) => {
      console.log(`${question.id}: ${question.message}`);
      question.options?.forEach(option => console.log(`  - ${option.value}: ${option.label}`));
    });
  }
}

export function emit(ctx: OutputContext, outcome: Outcome, result: Record<string, unknown> = {}) {
  const body = envelope(ctx.command || 'help', outcome, result);
  if (ctx.json) {
    console.log(JSON.stringify(body, null, 2));
    return body;
  }
  printHuman(body);
  return body;
}

export function printOk(ctx: OutputContext, data: Record<string, unknown> = {}) {
  return emit(ctx, 'ok', data);
}

export function printQuestion(ctx: OutputContext, text: string, id: string, options?: QuestionOption[]) {
  return emit(ctx, 'question', { message: text, questions: [{ id, message: text, options }] });
}

export function printError(ctx: OutputContext, message: string, code = 1): never {
  emit(ctx, 'error', { errors: [{ message }] });
  process.exit(code);
}
