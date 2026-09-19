import { Request, Response } from 'express';
import * as templateService from '../services/template.services';
import { logActivity } from '../services/activity.services';
import { toAuthor } from '../utils/author';

export async function list(_req: Request, res: Response) {
  res.json(await templateService.listTemplates());
}

export async function getOne(req: Request, res: Response) {
  res.json(await templateService.getTemplate(String(req.params.id)));
}

export async function fieldKeys(_req: Request, res: Response) {
  res.json(await templateService.listFieldKeys());
}

export async function create(req: Request, res: Response) {
  const user = req.user!;
  const template = await templateService.createTemplate(req.body, user.displayName);
  await logActivity(toAuthor(user), { action: 'template.create', targetName: template.name });
  res.status(201).json(template);
}

export async function update(req: Request, res: Response) {
  const template = await templateService.updateTemplate(String(req.params.id), req.body);
  await logActivity(toAuthor(req.user!), { action: 'template.update', targetName: template.name });
  res.json(template);
}

export async function remove(req: Request, res: Response) {
  const template = await templateService.deleteTemplate(String(req.params.id));
  await logActivity(toAuthor(req.user!), { action: 'template.delete', targetName: template.name });
  res.json({ ok: true });
}
