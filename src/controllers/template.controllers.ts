import { Request, Response } from 'express';
import * as templateService from '../services/template.services';

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
  res.status(201).json(template);
}

export async function update(req: Request, res: Response) {
  res.json(await templateService.updateTemplate(String(req.params.id), req.body));
}

export async function remove(req: Request, res: Response) {
  await templateService.deleteTemplate(String(req.params.id));
  res.json({ ok: true });
}
