import Composer from 'discourse/models/composer';
import showModal from "discourse/lib/show-modal";
import { findTopicList } from 'discourse/routes/build-topic-route';

export default Discourse.Route.extend({
  navMode: 'latest',

  renderTemplate() {
    const controller = this.controllerFor('projects.show');
    this.render('projects.show', { controller });
  },

  model(params) {
    var project = this.store.createRecord("project", {
            id: Handlebars.Utils.escapeExpression(params.project_guid)
        }),
        f = '';

    if (params.category) {
      f = 'c/';
      if (params.parent_category) { f += params.parent_category + '/'; }
      f += params.category + '/l/';
    }
    f += this.get('navMode');
    this.set('filterMode', f);

    if (params.category) { this.set('categorySlug', params.category); }
    if (params.parent_category) { this.set('parentCategorySlug', params.parent_category); }

    return project;
  },

  afterModel(project) {
    const controller = this.controllerFor('projects.show');
    controller.set('loading', true);

    const params = controller.getProperties('order', 'ascending');

    const categorySlug = this.get('categorySlug');
    const parentCategorySlug = this.get('parentCategorySlug');
    const filter = this.get('navMode');

    if (categorySlug) {
      var category = Discourse.Category.findBySlug(categorySlug, parentCategorySlug);
      if (parentCategorySlug) {
        params.filter = `projects/c/${parentCategorySlug}/${categorySlug}/${project.id}/l/${filter}`;
      } else {
        params.filter = `projects/c/${categorySlug}/${project.id}/l/${filter}`;
      }

      this.set('category', category);
    } else {
      params.filter = `projects/${project.id}/l/${filter}`;
      this.set('category', null);
    }

    return findTopicList(this.store, this.topicTrackingState, params.filter, params, {}).then(function(list) {
      controller.set('list', list);
      controller.set('canCreateTopic', list.get('can_create_topic'));
      controller.set('loading', false);
    });
  },

  titleToken() {
    const filterText = I18n.t('filters.' + this.get('navMode').replace('/', '.') + '.title'),
          controller = this.controllerFor('projects.show');

    //if (this.get('category')) {
      //return I18n.t('tagging.filters.with_category', { filter: filterText, tag: controller.get('model.id'), category: this.get('category.name')});
    //} else {
      //return I18n.t('tagging.filters.without_category', { filter: filterText, tag: controller.get('model.id')});
    //}
  },

  setupController(controller, model) {
    this.controllerFor('projects.show').setProperties({
      model,
      project: model,
      category: this.get('category'),
      filterMode: this.get('filterMode'),
      navMode: this.get('navMode'),
    });
  },

  actions: {
    invalidateModel() {
      this.refresh();
    },

    createTopic() {
      var controller = this.controllerFor("projects.show"),
          self = this;

      this.controllerFor('composer').open({
        categoryId: controller.get('category.id'),
        action: Composer.CREATE_TOPIC,
        draftKey: controller.get('list.draft_key'),
        draftSequence: controller.get('list.draft_sequence')
      }).then(function() {
        // Pre-fill the project specific attributes
        if (controller.get('model.id')) {
          var c = self.controllerFor('composer').get('model');
          c.set('parent_guids', controller.list.topic_list.parent_guids);
        }
      });
    },

    didTransition() {
      this.controllerFor("projects.show")._showFooter();
      return true;
    },

    willTransition(transition) {
      //if (!Discourse.SiteSettings.show_filter_by_tag) { return true; }

      //if ((transition.targetName.indexOf("discovery.parentCategory") !== -1 ||
        //    transition.targetName.indexOf("discovery.category") !== -1) && !transition.queryParams.allTags ) {
        //this.transitionTo("/projects" + transition.intent.url + "/" + this.currentModel.get("id"));
      //}
      return true;
    }
  }
});
