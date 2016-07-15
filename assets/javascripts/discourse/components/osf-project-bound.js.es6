export default  Ember.Component.extend({
  projectName: 'a',
  parentNames: ['a'],
  classNameBindings: [':osf-project', 'style', 'projectClass'],
  attributeBindings: ['href'],

  projectClass: function() {
    return "project-" + this.get('projectRecord.id');
  }.property('projectRecord.id'),

  /*href: function() {
    return '/forum/' + this.get('projectRecord.id');
  }.property('projectRecord.id'),*/
});
