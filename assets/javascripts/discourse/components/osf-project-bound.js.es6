export default  Ember.Component.extend({
  projectName: 'a',
  classNameBindings: [':osf-project', 'style', 'projectClass'],
  attributeBindings: ['href'],

  projectClass: function() {
    return "project-" + this.get('projectRecord.id');
  }.property('projectRecord.id'),

  href: function() {
    return '/projects/' + this.get('projectRecord.id');
  }.property('projectRecord.id'),
});
