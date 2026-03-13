# Entity List Component

A standardized, mobile-friendly UI component for displaying lists of entities with common actions like add, edit, delete, and toggle. Designed for consistency across different pages like schedules, webhooks, tasks, etc.

## Features

- **Standardized appearance**: Consistent card-based layout with status indicators
- **Mobile-friendly**: Includes floating action button for mobile devices
- **Flexible actions**: Support for per-item action buttons with icons
- **Loading and empty states**: Built-in handling for loading and empty states
- **Form integration**: Support for inline forms (add/edit)
- **Customizable**: Support for custom renderers when default layout isn't sufficient

## Basic Usage

```tsx
import { EntityList, FloatingActionButton, Icons, type EntityListItem, type EntityAction } from "../entity-list";

// Transform your data into EntityListItem format
const entityItems = (): EntityListItem<YourDataType>[] => {
  return yourData.map(item => ({
    id: item.id,
    title: item.name,
    subtitle: item.description, // Optional: shown in monospace font
    description: item.details,  // Optional: additional info
    status: item.enabled ? "enabled" : "disabled", // Optional: shows colored dot
    data: item // Original data passed to actions
  }));
};

// Define actions for each entity
const getActionsForItem = (item: YourDataType): EntityAction<YourDataType>[] => [
  {
    icon: Icons.Edit(),
    label: "Edit",
    onClick: (item) => setEditingItem(item)
  },
  {
    icon: Icons.Delete(),
    label: "Delete",
    onClick: deleteItem,
    variant: "danger" // Makes the button red
  }
];

// Render the list
<EntityList
  items={entityItems()}
  loading={isLoading}
  emptyMessage="No items yet"
  addButtonText="+ Add item"
  onAdd={() => setShowForm(true)}
  actions={getActionsForItem}
>
  {/* Optional: inline forms or other content */}
  <Show when={showForm()}>
    <YourForm />
  </Show>
</EntityList>

{/* Mobile floating action button */}
<Show when={!showForm()}>
  <FloatingActionButton
    icon={Icons.Plus()}
    label="Add item"
    onClick={() => setShowForm(true)}
  />
</Show>
```

## Component Props

### EntityList Props

- `items`: Array of `EntityListItem<T>` - The data to display
- `loading`: boolean - Shows loading state
- `emptyMessage`: string - Message shown when no items
- `addButtonText`: string - Text for the add button
- `onAdd`: function - Called when add button is clicked
- `showAddButton`: boolean (default: true) - Whether to show add button
- `actions`: EntityAction[] or function - Actions for each item
- `children`: JSX.Element - Optional content (forms, etc.)
- `customRenderer`: function - Custom renderer for items

### EntityAction Type

```tsx
type EntityAction<T> = {
  icon: JSX.Element;     // Icon component
  label: string;         // Tooltip/title text
  onClick: (item: T) => void; // Click handler
  variant?: "default" | "danger"; // Styling variant
};
```

### EntityListItem Type

```tsx
type EntityListItem<T> = {
  id: string;            // Unique identifier
  title: string;         // Main title
  subtitle?: string;     // Secondary text (monospace)
  description?: string;  // Additional details
  status?: "enabled" | "disabled" | "success" | "error" | "warning"; // Status indicator
  metadata?: string;     // Extra metadata
  data: T;              // Original data
};
```

## Status Indicators

The component supports colored status dots based on the `status` field:

- `enabled` / `success`: Green dot
- `disabled`: Gray dot
- `error`: Red dot
- `warning`: Yellow dot

## Available Icons

The component includes common icons:

```tsx
Icons.Plus()      // Add/create
Icons.Play()      // Run/execute
Icons.Pause()     // Pause/stop
Icons.Edit()      // Edit
Icons.Delete()    // Delete
Icons.Copy()      // Copy
Icons.Toggle(enabled) // Toggle on/off
```

## Mobile Considerations

- Use `FloatingActionButton` for primary actions on mobile
- Add `mb-20` class to content containers to provide space for the FAB
- The FAB includes hover tooltips and proper touch targets
- All buttons have appropriate touch targets (minimum 44px)

## Advanced Usage

### Dynamic Actions

Actions can be a function that returns different actions per item:

```tsx
const getActions = (item: YourType): EntityAction<YourType>[] => {
  const baseActions = [
    { icon: Icons.Edit(), label: "Edit", onClick: editItem }
  ];
  
  if (item.canDelete) {
    baseActions.push({
      icon: Icons.Delete(),
      label: "Delete", 
      onClick: deleteItem,
      variant: "danger"
    });
  }
  
  return baseActions;
};

<EntityList actions={getActions} ... />
```

### Custom Rendering

For complex layouts, use a custom renderer:

```tsx
const customRenderer = (item: EntityListItem<YourType>, actions?: EntityAction<YourType>[]) => (
  <div class="custom-layout">
    {/* Your custom layout */}
  </div>
);

<EntityList customRenderer={customRenderer} ... />
```

## Examples

See the refactored pages for complete examples:
- `src/client/pages/schedules-refactored.tsx`
- `src/client/pages/webhooks-refactored.tsx` 
- `src/client/pages/tasks-refactored.tsx`