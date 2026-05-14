import path from 'node:path';
import { CliContext, optionValue } from '../lib/args';
import { postLaunchPlan } from '../lib/api-client';
import { detectProject } from '../lib/detect';
import { emit } from '../lib/output';

export async function createPlan(ctx: CliContext, rootArg?: string) {
  const root = path.resolve(rootArg || ctx.commandArgs.find(arg => !arg.startsWith('-')) || process.cwd());
  const detection = await detectProject(root);
  const plan = await postLaunchPlan({
    root,
    flags: {
      image: optionValue('--image', ctx.commandArgs),
      serviceRoot: optionValue('--service-root', ctx.commandArgs),
      remoteBuilder: ctx.commandArgs.includes('--remote-builder'),
    },
    evidence: detection.evidence,
  });
  return { root, detection, plan };
}

export async function plan(ctx: CliContext) {
  const result = await createPlan(ctx);
  const outcome = result.plan.questions.length > 0 ? 'question' : 'success';
  emit(ctx, outcome, {
    message: `${result.plan.framework || 'Unknown'} app at ${result.plan.serviceRoot}; strategies: ${result.plan.buildStrategies.map(item => item.strategy).join(', ') || 'none'}.`,
    plan: result.plan,
    questions: result.plan.questions.map(question => ({ id: question.id, message: question.prompt, options: question.options })),
    warnings: result.plan.warnings.map(warning => warning.message),
  });
}
