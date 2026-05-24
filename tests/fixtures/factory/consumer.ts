import { createOrgClient } from './factory.ts';

export const orgClient = createOrgClient('http://localhost');

export const listOrgs = async () => {
  return orgClient.orgs.$get();
};

export const createOrg = async () => {
  return orgClient.orgs.$post({ json: { name: 'x' } });
};
