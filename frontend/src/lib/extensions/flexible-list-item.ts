import ListItem from '@tiptap/extension-list-item'

// Override the default ListItem so list items can contain any block
// (code blocks, blockquotes, nested lists, multiple paragraphs, etc.)
// instead of the StarterKit default `'paragraph block*'` which pins the
// first child to a plain paragraph.
export const FlexibleListItem = ListItem.extend({
  content: 'block+',
})
