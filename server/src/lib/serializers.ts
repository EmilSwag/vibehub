import type { ExternalLink, Project, User } from "@prisma/client";

// Never spread a raw User/Project row into a response — githubAccessToken and
// passwordHash must never leave the server (ARCHITECTURE.md §3 privacy model).
export function toPublicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    archetype: user.archetype,
    role: user.role,
    isDevAccount: user.isDevAccount,
    createdAt: user.createdAt,
  };
}

export function toMeUser(user: User) {
  return {
    ...toPublicUser(user),
    email: user.email,
    githubUsername: user.githubUsername,
    // null until POST /users/me/onboarding/complete — the web gates on this.
    onboardedAt: user.onboardedAt,
  };
}

export function toPublicLink(link: ExternalLink) {
  return {
    id: link.id,
    url: link.url,
    label: link.label,
    icon: link.icon,
    order: link.order,
  };
}

export function toPublicProject(project: Project) {
  return {
    id: project.id,
    ownerId: project.ownerId,
    slug: project.slug,
    name: project.name,
    description: project.description,
    repoUrl: project.repoUrl,
    liveUrl: project.liveUrl,
    coverImageUrl: project.coverImageUrl,
    isPublic: project.isPublic,
    likeCount: project.likeCount,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
